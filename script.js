import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';


// ----- State -----

let scene, camera, renderer, controls;
let stars = [];
let constellationLines = [];
let currentObserver = null;

let arActive = false;
let headingOffset = 0;
let rawAlpha = 0, rawBeta = 0, rawGamma = 0;

const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const tmpEuler = new THREE.Euler();


// ----- Coordinate conversion -----

// Altitude/azimuth (degrees) to a point on a sphere around the viewer.
function altAzToVector(altitude, azimuth, radius = 100) {
  const altRad = altitude * Math.PI / 180;
  const azRad = azimuth * Math.PI / 180;

  const x = radius * Math.cos(altRad) * Math.sin(azRad);
  const y = radius * Math.sin(altRad);
  const z = -radius * Math.cos(altRad) * Math.cos(azRad);

  return new THREE.Vector3(x, y, z);
}

function magToSize(mag) {
  const size = 1.5 * Math.pow(2.512, (1 - mag) * 0.4);
  return Math.max(0.15, Math.min(size, 4));
}


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

  constellationLines = [];
  for (const feature of data.features) {
    const geom = feature.geometry;
    const paths = geom.type === 'MultiLineString'
      ? geom.coordinates
      : [geom.coordinates];

    for (const path of paths) {
      const points = path.map(([lon, lat]) => {
        const ra = lon < 0 ? (lon + 360) / 15 : lon / 15;
        return { ra, dec: lat };
      });
      constellationLines.push(points);
    }
  }
  console.log('loaded constellation paths:', constellationLines.length);
}


// ----- Drawing -----

function clearSky() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (obj.isMesh || obj.isLine) scene.remove(obj);
  }
}

function plotStars(observer, time) {
  for (const star of stars) {
    const hor = Astronomy.Horizon(time, observer, star.ra, star.dec, 'normal');
    if (hor.altitude < 0) continue;

    const pos = altAzToVector(hor.altitude, hor.azimuth);
    const geometry = new THREE.SphereGeometry(magToSize(star.mag), 6, 6);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dot = new THREE.Mesh(geometry, material);
    dot.position.copy(pos);
    scene.add(dot);
  }
}

function drawConstellations(observer, time) {
  const material = new THREE.LineBasicMaterial({ color: 0x2244aa });

  for (const path of constellationLines) {
    const vectors = [];
    for (const pt of path) {
      const hor = Astronomy.Horizon(time, observer, pt.ra, pt.dec, 'normal');
      if (hor.altitude < -10) { vectors.length = 0; break; }
      vectors.push(altAzToVector(hor.altitude, hor.azimuth));
    }
    if (vectors.length < 2) continue;

    const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
    scene.add(new THREE.Line(geometry, material));
  }
}

function plotBody(body, color, size, observer, time) {
  const equ = Astronomy.Equator(body, time, observer, true, true);
  const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, 'normal');
  if (hor.altitude < 0) return;

  const pos = altAzToVector(hor.altitude, hor.azimuth);
  const geometry = new THREE.SphereGeometry(size, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(pos);
  scene.add(mesh);
}

function renderSky(observer, time) {
  clearSky();
  plotStars(observer, time);
  drawConstellations(observer, time);
  plotBody(Astronomy.Body.Sun, 0xffdd00, 6, observer, time);
  plotBody(Astronomy.Body.Moon, 0x636363, 5, observer, time);
}


// ----- Scene setup -----

function startScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  camera.position.set(0, 0, 0.1);
  controls.target.set(0, 0, 0);
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
  if (arActive) {
    setCameraFromDevice();
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
}

// Point the camera using the phone's orientation, with the heading correction
// applied at render time so calibration takes effect immediately.
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
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  currentObserver = new Astronomy.Observer(latitude, longitude, 0);
  renderSky(currentObserver, new Date());
}

function onLocationError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      alert('Location permission denied.');
      break;
    case error.POSITION_UNAVAILABLE:
      alert('Location information is unavailable.');
      break;
    case error.TIMEOUT:
      alert('Location request timed out.');
      break;
    default:
      alert('An unknown location error occurred.');
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
  const needsPermission =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (needsPermission) {
    DeviceOrientationEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('deviceorientation', onOrientation);
        } else {
          alert('Orientation permission denied.');
        }
      })
      .catch(err => alert('Orientation error: ' + err));
  } else {
    window.addEventListener('deviceorientation', onOrientation);
  }
}

function onOrientation(event) {
  if (event.alpha === null) return;
  rawAlpha = event.alpha;
  rawBeta = event.beta;
  rawGamma = event.gamma;
  arActive = true;

  document.getElementById('arReadout').textContent =
    `AZ ${event.alpha.toFixed(0)}  ALT ${event.beta.toFixed(0)}  ROLL ${event.gamma.toFixed(0)}`;
}


// ----- Calibration -----

// Aim the reticle at the Moon and call this. Shifts the heading so the
// reticle direction matches the Moon's true bearing.
function calibrateOnMoon() {
  if (!currentObserver) { alert('Find location first.'); return; }

  setCameraFromDevice();

  const time = new Date();
  const equ = Astronomy.Equator(Astronomy.Body.Moon, time, currentObserver, true, true);
  const hor = Astronomy.Horizon(time, currentObserver, equ.ra, equ.dec, 'normal');
  const moonAz = hor.azimuth;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  let crossAz = Math.atan2(dir.x, -dir.z) * 180 / Math.PI;
  if (crossAz < 0) crossAz += 360;

  let diff = crossAz - moonAz;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  headingOffset -= diff;
  setCameraFromDevice();
}


// ----- App start -----

function initializeApp() {
  const overlay = document.getElementById('introOverlay');
  overlay.style.display = 'none';

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  enableOrientation();
  startCamera();
  findLocation();

  const arUI = document.getElementById('arUI');
  arUI.classList.remove('hidden');
}


// ----- Wiring -----

document.getElementById('startAppBtn').addEventListener('click', initializeApp);
document.getElementById('calBtn').addEventListener('click', calibrateOnMoon);

loadStars();
loadConstellations();
startScene();