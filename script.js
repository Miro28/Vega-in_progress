import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';


let headingOffset = 0;  // correction applied to compass heading
let currentObserver = null;  // so calibrate can access location
let arActive = false;
let rawAlpha = 0, rawBeta = 0, rawGamma = 0;
let deviceAngles = { alpha: 0, beta: 0, gamma: 0 };
const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° around X
const tmpEuler = new THREE.Euler();

let scene, camera, renderer, controls;
let stars = [];

function FindLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(showPosition, showError);
    } else {
        alert("Geolocation is not supported by this browser.");
    }


    function showPosition(position) {
        function clearSky() {
            for (let i = scene.children.length - 1; i >= 0; i--) {
              const obj = scene.children[i];
              if (obj.isMesh || obj.isLine) scene.remove(obj);
            }
          }
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const observer = new Astronomy.Observer(latitude, longitude, 0);
        currentObserver = observer;
        const time = new Date();
        clearSky();
        plotStars(stars, observer, time);
        drawConstellations(observer, time);
        plotBody(Astronomy.Body.Sun,  0xffdd00, 6, observer, time);  // yellow, big
        plotBody(Astronomy.Body.Moon, 0x636363, 5, observer, time);  // grey, big
    }

    function showError(error) {
        switch (error.code) {
            case error.PERMISSION_DENIED:
                alert("User denied the request for Geolocation.");
                break;
            case error.POSITION_UNAVAILABLE:
                alert("Location information is unavailable.");
                break;
            case error.TIMEOUT:
                alert("The request to get user location timed out.");
                break;
            case error.UNKNOWN_ERROR:
                alert("An unknown error occurred.");
                break;
        }
    }
}

function showSun(latitude, longitude) {
    const observer = new Astronomy.Observer(latitude, longitude, 0);
    const time = new Date();
    const equ = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
    const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, 'normal');

    
}

function showMoon(latitude, longitude) {
    const observer = new Astronomy.Observer(latitude, longitude, 0);
    const time = new Date();
    const equ = Astronomy.Equator(Astronomy.Body.Moon, time, observer, true, true);
    const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, 'normal');
}


function showStars(latitude, longitude) {
    const observer = new Astronomy.Observer(latitude, longitude, 0);
    const time = new Date();
    let result = "";
  
    for (const star of stars) {
      const hor = Astronomy.Horizon(time, observer, star.ra, star.dec, 'normal');
      const visible = hor.altitude > 0 ? "" : "  (below horizon)";
      result += `\n${star.name}: alt ${hor.altitude.toFixed(1)}°, az ${hor.azimuth.toFixed(1)}°${visible}`;
    }
  
  }

  function altAzToVector(altitude, azimuth, radius = 100) {
    // convert degrees to radians (Three.js uses radians)
    const altRad = altitude * Math.PI / 180;
    const azRad  = azimuth  * Math.PI / 180;
  
    // altitude = how high up, azimuth = compass direction
    const x = radius * Math.cos(altRad) * Math.sin(azRad);
    const y = radius * Math.sin(altRad);              // up
    const z = -radius * Math.cos(altRad) * Math.cos(azRad);
  
    return new THREE.Vector3(x, y, z);
  }

  function startScene(){
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

    function animate() {
        requestAnimationFrame(animate);
        if (arActive) {
          setCameraFromDevice();
        } else {
          controls.update();
        }
        renderer.render(scene, camera);
    }
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    animate();
}



function setCameraFromDevice() {
    const deg2rad = Math.PI / 180;
    // Apply the offset here during rendering instead of on sensor tick
    const alpha = (rawAlpha - headingOffset) * deg2rad; 
    const beta  = rawBeta  * deg2rad; 
    const gamma = rawGamma * deg2rad; 
    const orient = (screen.orientation?.angle || 0) * deg2rad; 

    tmpEuler.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(tmpEuler);
    camera.quaternion.multiply(q1);                          
    camera.quaternion.multiply(q0.setFromAxisAngle(zee, -orient)); 
}

function plotStars(stars, observer, time) {
    let count = 0;
    for (const star of stars) {
      const hor = Astronomy.Horizon(time, observer, star.ra, star.dec, 'normal');
      if (hor.altitude < 0) continue; // skip below-horizon stars
  
      const pos = altAzToVector(hor.altitude, hor.azimuth);
  
      const size = magToSize(star.mag);
      const geometry = new THREE.SphereGeometry(size, 6, 6);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const dot = new THREE.Mesh(geometry, material);
      dot.position.copy(pos);
      scene.add(dot);
      count++;
    }
    console.log("stars plotted:", count, "scene children:", scene.children.length);
  }

  function drawConstellations(observer, time) {
    const material = new THREE.LineBasicMaterial({ color: 0x2244aa }); // dim blue
  
    for (const path of constellationLines) {
      const vectors = [];
      for (const pt of path) {
        const hor = Astronomy.Horizon(time, observer, pt.ra, pt.dec, 'normal');
        // include the point even if slightly below horizon so lines don't break oddly;
        // skip only deeply-below ones
        if (hor.altitude < -10) { vectors.length = 0; break; }
        vectors.push(altAzToVector(hor.altitude, hor.azimuth));
      }
      if (vectors.length < 2) continue; // need at least 2 points for a line
  
      const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
      const line = new THREE.Line(geometry, material);
      line.userData.isConstellation = true;  // tag so clearSky can remove it
      scene.add(line);
    }
  }

  function plotBody(body, color, size, observer, time) {
    const equ = Astronomy.Equator(body, time, observer, true, true);
    const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, 'normal');
    if (hor.altitude < 0) return; // below horizon, skip
  
    const pos = altAzToVector(hor.altitude, hor.azimuth);
  
    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    scene.add(mesh);
  }



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
      stars.push({ name: cols[nameI] || "", ra, dec, mag, hip: cols[hipI] });
    }
    console.log("loaded stars:", stars.length);
  }

  let constellationLines = [];  // top-level, holds the line paths

async function loadConstellations() {
  const res = await fetch('constellations.lines.json');
  const data = await res.json();

  constellationLines = [];
  for (const feature of data.features) {
    const geom = feature.geometry;
    // GeoJSON MultiLineString = array of line paths; LineString = single path
    const paths = geom.type === 'MultiLineString'
      ? geom.coordinates
      : [geom.coordinates];

    for (const path of paths) {
      // each path is a list of [lon, lat] points
      const points = path.map(([lon, lat]) => {
        // convert their longitude back to RA in hours
        const ra = lon < 0 ? (lon + 360) / 15 : lon / 15;
        const dec = lat;
        return { ra, dec };
      });
      constellationLines.push(points);
    }
  }
  console.log("loaded constellation paths:", constellationLines.length);
}

function magToSize(mag) {
    // brightest stars big, faint ones tiny, exponential-ish falloff
    // mag -1.5 (Sirius) -> large, mag 4 -> very small
    const size = 1.5 * Math.pow(2.512, (1 - mag) * 0.4);
    return Math.max(0.15, Math.min(size, 4)); // clamp so nothing's absurd
  }
  async function startCamera() {
    // SECURITY CHECK: Ensure the browser allows camera access (Requires HTTPS or localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera API blocked. Are you testing on HTTP? Mobile browsers require HTTPS to open the camera.");
        return; 
    }

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', ''); 
    video.muted = true;
    
    video.style.position = 'fixed';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.objectFit = 'cover'; 
    video.style.zIndex = '1'; 
    document.body.appendChild(video);

    const isPortrait = window.innerHeight > window.innerWidth;
    const idealWidth = isPortrait ? 1080 : 1920;
    const idealHeight = isPortrait ? 1920 : 1080;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'environment', 
                width: { ideal: idealWidth }, 
                height: { ideal: idealHeight } 
            }
        });
        video.srcObject = stream;
        
        // THE FIX: Do NOT `await` this. Let it play in the background so it doesn't freeze the initialization.
        video.play().catch(e => console.warn("Video play warning:", e));
        
    } catch (err) {
        alert('Camera error: ' + err.message);
    }
}
function startAR() {
    startCamera();
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(state => {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', onOrientation);
          } else {
            alert('Orientation permission denied');
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
    
    // Keeping your readout for testing
    document.getElementById('arReadout').textContent =
        `a${event.alpha.toFixed(0)} b${event.beta.toFixed(0)} g${event.gamma.toFixed(0)}`;
}

function calibrateOnMoon() {
    if (!currentObserver) { alert('Find location first'); return; }
  
    // Force an immediate camera update to get an accurate baseline
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
  
    // THE FIX: Subtract the difference to account for inverted rotation
    headingOffset -= diff;
    
    // Snap camera to the new position instantly
    setCameraFromDevice();
}
    
async function initializeApp() {
    // 1. HARD REMOVAL: Hide the overlay immediately.
    // It is gone. It cannot block the screen anymore.
    const overlay = document.getElementById('introOverlay');
    overlay.style.display = 'none'; 
    overlay.style.opacity = '0';

    // 2. We trigger the sensors as individual "fire-and-forget" tasks
    // If one fails, the app still runs and the overlay is already gone.
    
    // Attempt Fullscreen
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }

    // Attempt Orientation
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(state => {
                if (state === 'granted') window.addEventListener('deviceorientation', onOrientation);
            })
            .catch(console.error);
    } else {
        window.addEventListener('deviceorientation', onOrientation);
    }

    // Attempt Camera
    startCamera();

    // Attempt Location
    FindLocation();

    // 3. FORCE SHOW the AR UI
    const arUI = document.getElementById('arUI');
    if (arUI) {
        arUI.classList.remove('hidden');
        arUI.style.opacity = '1';
    }
}

// Modify your existing onOrientation function slightly to call updateHUD:
// Add this line inside onOrientation: 
// updateHUD(event.alpha, event.beta, event.gamma);

// --- EVENT LISTENERS ---
document.getElementById('startAppBtn').addEventListener('click', initializeApp);
document.getElementById('calBtn').addEventListener('click', calibrateOnMoon);

// Start background loads
loadStars();
loadConstellations();
startScene();