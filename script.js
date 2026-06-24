import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';


// ----- State -----

let scene, camera, renderer, controls;
let stars = [];
let starPoints = null;
let plottedStars = [];          // { name, position } for identification
let constellationGroups = [];   // { id, name, paths, lines }
let currentObserver = null;

let smoothedQuat = new THREE.Quaternion();
let smoothReady = false;

let arActive = false;
let identifyOn = false;
let headingOffset = 0;
let rawAlpha = 0, rawBeta = 0, rawGamma = 0;

let smoothAlpha = 0, smoothBeta = 0, smoothGamma = 0;
let smoothingReady = false;

const MAGNETIC_DECLINATION = 5; // degrees east, approx for Bulgaria
const SKY_RADIUS = 1000;        // large so small camera motion gives no parallax

const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const tmpEuler = new THREE.Euler();

const tmpVec = new THREE.Vector3();
const camDir = new THREE.Vector3();

const CONSTELLATION_NAMES = {
  And:'Andromeda', Ant:'Antlia', Aps:'Apus', Aqr:'Aquarius', Aql:'Aquila',
  Ara:'Ara', Ari:'Aries', Aur:'Auriga', Boo:'Bootes', Cae:'Caelum',
  Cam:'Camelopardalis', Cnc:'Cancer', CVn:'Canes Venatici', CMa:'Canis Major',
  CMi:'Canis Minor', Cap:'Capricornus', Car:'Carina', Cas:'Cassiopeia',
  Cen:'Centaurus', Cep:'Cepheus', Cet:'Cetus', Cha:'Chamaeleon', Cir:'Circinus',
  Col:'Columba', Com:'Coma Berenices', CrA:'Corona Australis', CrB:'Corona Borealis',
  Crv:'Corvus', Crt:'Crater', Cru:'Crux', Cyg:'Cygnus', Del:'Delphinus',
  Dor:'Dorado', Dra:'Draco', Equ:'Equuleus', Eri:'Eridanus', For:'Fornax',
  Gem:'Gemini', Gru:'Grus', Her:'Hercules', Hor:'Horologium', Hya:'Hydra',
  Hyi:'Hydrus', Ind:'Indus', Lac:'Lacerta', Leo:'Leo', LMi:'Leo Minor',
  Lep:'Lepus', Lib:'Libra', Lup:'Lupus', Lyn:'Lynx', Lyr:'Lyra', Men:'Mensa',
  Mic:'Microscopium', Mon:'Monoceros', Mus:'Musca', Nor:'Norma', Oct:'Octans',
  Oph:'Ophiuchus', Ori:'Orion', Pav:'Pavo', Peg:'Pegasus', Per:'Perseus',
  Phe:'Phoenix', Pic:'Pictor', Psc:'Pisces', PsA:'Piscis Austrinus', Pup:'Puppis',
  Pyx:'Pyxis', Ret:'Reticulum', Sge:'Sagitta', Sgr:'Sagittarius', Sco:'Scorpius',
  Scl:'Sculptor', Sct:'Scutum', Ser:'Serpens', Sex:'Sextans', Tau:'Taurus',
  Tel:'Telescopium', Tri:'Triangulum', TrA:'Triangulum Australe', Tuc:'Tucana',
  UMa:'Ursa Major', UMi:'Ursa Minor', Vel:'Vela', Vir:'Virgo', Vol:'Volans', Vul:'Vulpecula'
};


// ----- Coordinate conversion -----

function altAzToVector(altitude, azimuth, radius = SKY_RADIUS) {
  const altRad = altitude * Math.PI / 180;
  const azRad = azimuth * Math.PI / 180;
  const x = radius * Math.cos(altRad) * Math.sin(azRad);
  const y = radius * Math.sin(altRad);
  const z = -radius * Math.cos(altRad) * Math.cos(azRad);
  return new THREE.Vector3(x, y, z);
}

function magToSize(mag) {
  const size = 7 * Math.pow(2.512, (1 - mag) * 0.18);
  return Math.max(2, Math.min(size, 26));
}

function lerpAngle(a, b, k) {
  let diff = b - a;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return a + diff * k;
}


// ----- Textures -----

function makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const glowTexture = makeGlowTexture();


// ----- Data loading -----

async function loadStars() {
  const res = await fetch('stars.csv');
  const text = await res.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const idx = name => headers.indexOf(name);
  const raI = idx('ra'), decI = idx('dec'), magI = idx('mag'),
        nameI = idx('proper'), hipI = idx('hip');

  stars = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const ra = parseFloat(cols[raI]);
    const dec = parseFloat(cols[decI]);
    const mag = parseFloat(cols[magI]);
    if (isNaN(ra) || isNaN(dec) || isNaN(mag)) continue;
    stars.push({ name: cols[nameI] || '', ra, dec, mag, hip: cols[hipI] });
  }
  console.log('loaded stars:', stars.length);
}

async function loadConstellations() {
  const res = await fetch('constellations.lines.json');
  const data = await res.json();
  constellationGroups = [];
  for (const feature of data.features) {
    const id = feature.id;
    const geom = feature.geometry;
    const rawPaths = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
    const paths = rawPaths.map(path =>
      path.map(([lon, lat]) => ({ ra: lon < 0 ? (lon + 360) / 15 : lon / 15, dec: lat }))
    );
    constellationGroups.push({
      id,
      name: CONSTELLATION_NAMES[id] || id,
      paths,
      lines: []
    });
  }
  console.log('loaded constellations:', constellationGroups.length);
}


// ----- Drawing -----

function clearSky() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (obj.isMesh || obj.isLine || obj.isPoints || obj.isSprite) scene.remove(obj);
  }
  starPoints = null;
  plottedStars = [];
}

function plotStars(observer, time) {
  const positions = [];
  const sizes = [];
  const opacities = [];
  plottedStars = [];

  for (const star of stars) {
    const hor = Astronomy.Horizon(time, observer, star.ra, star.dec, 'normal');
    if (hor.altitude < 0) continue;

    const pos = altAzToVector(hor.altitude, hor.azimuth);
    positions.push(pos.x, pos.y, pos.z);
    sizes.push(magToSize(star.mag));
    opacities.push(Math.max(0.35, Math.min(1, 1.1 - star.mag * 0.12)));

    if (star.name) plottedStars.push({ name: star.name, position: pos.clone() });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(opacities, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { glow: { value: glowTexture } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D glow;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(glow, gl_PointCoord);
        gl_FragColor = vec4(tex.rgb, tex.a * vAlpha);
      }
    `
  });

  starPoints = new THREE.Points(geometry, material);
  scene.add(starPoints);
}

function drawConstellations(observer, time) {
  for (const group of constellationGroups) {
    group.lines = [];
    for (const path of group.paths) {
      const vectors = [];
      for (const pt of path) {
        const hor = Astronomy.Horizon(time, observer, pt.ra, pt.dec, 'normal');
        if (hor.altitude < -10) { vectors.length = 0; break; }
        vectors.push(altAzToVector(hor.altitude, hor.azimuth));
      }
      if (vectors.length < 2) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
      const material = new THREE.LineBasicMaterial({ color: 0x6fa0ff, transparent: true, opacity: 0.4 });
      const line = new THREE.Line(geometry, material);
      group.lines.push(line);
      scene.add(line);
    }
  }
}

function plotBody(body, coreColor, haloColor, size, observer, time) {
  const equ = Astronomy.Equator(body, time, observer, true, true);
  const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, 'normal');
  if (hor.altitude < 0) return;

  const pos = altAzToVector(hor.altitude, hor.azimuth);

  // scale physical size up with the larger sky radius
  const coreSize = size * (SKY_RADIUS / 100);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(coreSize, 32, 32),
    new THREE.MeshBasicMaterial({ color: coreColor })
  );
  core.position.copy(pos);
  scene.add(core);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture,
    color: haloColor,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  halo.scale.setScalar(coreSize * 5);
  halo.position.copy(pos);
  scene.add(halo);
}

function renderSky(observer, time) {
  clearSky();
  plotStars(observer, time);
  drawConstellations(observer, time);
  plotBody(Astronomy.Body.Sun, 0xfff2cc, 0xffcc55, 5, observer, time);
  plotBody(Astronomy.Body.Moon, 0xd8d8e0, 0x8899bb, 4, observer, time);
}


// ----- Scene setup -----

function startScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);

  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  camera.position.set(0, 0, 0);
  controls.target.set(0, 0, -1);
  controls.rotateSpeed = -0.3;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (arActive) setCameraFromDevice();
  else controls.update();

  if (identifyOn) updateIdentification();

  renderer.render(scene, camera);
}

// Orientation-only camera: rotates with the device, never translates, so the
// distant sky shows no parallax when the phone is physically moved.
function setCameraFromDevice() {
  const deg2rad = Math.PI / 180;
  const alpha = (rawAlpha - headingOffset) * deg2rad;
  const beta = rawBeta * deg2rad;
  const gamma = rawGamma * deg2rad;
  const orient = (screen.orientation?.angle || 0) * deg2rad;

  tmpEuler.set(beta, alpha, -gamma, 'YXZ');
  camera.quaternion.setFromEuler(tmpEuler);
  camera.quaternion.multiply(q1);
  camera.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));

  // smooth jitter by blending toward the new orientation (slerp avoids flips)
  if (!smoothReady) {
    smoothedQuat.copy(camera.quaternion);
    smoothReady = true;
  } else {
    smoothedQuat.slerp(camera.quaternion, 0.2);
    camera.quaternion.copy(smoothedQuat);
  }

  camera.position.set(0, 0, 0);
}


// ----- Identification -----

function updateIdentification() {
  const label = document.getElementById('starLabel');
  camera.getWorldDirection(camDir);

  let bestStar = null, bestStarDot = 0.9995;
  for (const s of plottedStars) {
    tmpVec.copy(s.position).normalize();
    const dot = tmpVec.dot(camDir);
    if (dot > bestStarDot) { bestStarDot = dot; bestStar = s; }
  }

  let bestGroup = null, bestGroupDot = 0.999;
  for (const group of constellationGroups) {
    for (const line of group.lines) {
      line.material.opacity = 0.4;
      const arr = line.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        tmpVec.set(arr[i], arr[i + 1], arr[i + 2]).normalize();
        const dot = tmpVec.dot(camDir);
        if (dot > bestGroupDot) { bestGroupDot = dot; bestGroup = group; }
      }
    }
  }
  if (bestGroup) {
    for (const line of bestGroup.lines) line.material.opacity = 0.95;
  }

  if (bestStar) label.textContent = bestStar.name;
  else if (bestGroup) label.textContent = bestGroup.name;
  else label.textContent = '';
}


// ----- Location -----

function findLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(onPosition, onLocationError);
}

function onPosition(position) {
  currentObserver = new Astronomy.Observer(
    position.coords.latitude, position.coords.longitude, 0);
  renderSky(currentObserver, new Date());
}

function onLocationError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED: alert('Location permission denied.'); break;
    case error.POSITION_UNAVAILABLE: alert('Location information is unavailable.'); break;
    case error.TIMEOUT: alert('Location request timed out.'); break;
    default: alert('An unknown location error occurred.');
  }
}


// ----- Camera feed -----

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera unavailable. The camera requires an HTTPS connection.');
    return;
  }

  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.muted = true;
  video.style.position = 'fixed';
  video.style.inset = '0';
  video.style.width = '100vw';
  video.style.height = '100vh';
  video.style.objectFit = 'cover';
  video.style.zIndex = '1';
  document.body.appendChild(video);

  const portrait = window.innerHeight > window.innerWidth;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: portrait ? 1080 : 1920 },
        height: { ideal: portrait ? 1920 : 1080 }
      }
    });
    video.srcObject = stream;
    video.play().catch(e => console.warn('Video play warning:', e));
  } catch (err) {
    alert('Camera error: ' + err.message);
  }
}


// ----- Orientation sensors -----

function enableOrientation() {
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onOrientation);
  } else if (typeof DeviceOrientationEvent !== 'undefined' &&
             typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(state => {
        if (state === 'granted') window.addEventListener('deviceorientation', onOrientation);
        else alert('Orientation permission denied.');
      })
      .catch(err => alert('Orientation error: ' + err));
  } else {
    window.addEventListener('deviceorientation', onOrientation);
  }
}

function onOrientation(event) {
  if (event.alpha === null) return;
  rawAlpha = event.alpha + MAGNETIC_DECLINATION;
  rawBeta = event.beta;
  rawGamma = event.gamma;
  arActive = true;
}


// ----- Calibration -----

function calibrateOnBody(body) {
  if (!currentObserver) { alert('Find location first.'); return; }
  setCameraFromDevice();

  const time = new Date();
  const equ = Astronomy.Equator(body, time, currentObserver, true, true);
  const hor = Astronomy.Horizon(time, currentObserver, equ.ra, equ.dec, 'normal');
  const bodyAz = hor.azimuth;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  let crossAz = Math.atan2(dir.x, -dir.z) * 180 / Math.PI;
  if (crossAz < 0) crossAz += 360;

  let diff = crossAz - bodyAz;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  headingOffset -= diff;
  setCameraFromDevice();
}


// ----- App start -----

function initializeApp() {
  document.getElementById('introOverlay').style.display = 'none';

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  enableOrientation();
  startCamera();
  findLocation();

  document.getElementById('arUI').classList.remove('hidden');
}

function toggleIdentify() {
  identifyOn = !identifyOn;
  document.getElementById('identifyBtn').classList.toggle('active', identifyOn);
  if (!identifyOn) {
    document.getElementById('starLabel').textContent = '';
    for (const group of constellationGroups) {
      for (const line of group.lines) line.material.opacity = 0.4;
    }
  }
}

function startIntroStarfield() {
  const canvas = document.getElementById('introStars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
 
  let w, h, starList;
  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }
  function seed() {
    starList = [];
    const count = Math.floor((w * h) / 9000); // density scales with screen
    for (let i = 0; i < count; i++) {
      starList.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 0.3,
        drift: Math.random() * 0.15 + 0.02,
        tw: Math.random() * Math.PI * 2,          // twinkle phase
        twSpeed: Math.random() * 0.02 + 0.005
      });
    }
  }
 
  resize();
  seed();
  window.addEventListener('resize', () => { resize(); seed(); });
 
  function frame() {
    // stop animating once the intro is hidden
    const overlay = document.getElementById('introOverlay');
    if (overlay && overlay.style.display === 'none') return;
 
    ctx.clearRect(0, 0, w, h);
    for (const s of starList) {
      s.x -= s.drift;            // gentle leftward drift
      if (s.x < -2) s.x = w + 2;
      s.tw += s.twSpeed;
      const alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.tw)); // twinkle
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220, 230, 255, ${alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  frame();
}


// ----- Wiring -----

document.getElementById('startAppBtn').addEventListener('click', initializeApp);
document.getElementById('calBtn').addEventListener('click', () => calibrateOnBody(Astronomy.Body.Moon));
document.getElementById('identifyBtn').addEventListener('click', toggleIdentify);

startIntroStarfield();
loadStars();
loadConstellations();
startScene();