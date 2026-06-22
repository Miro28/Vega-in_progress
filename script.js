import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let headingOffset = 0;  // correction applied to compass heading
let currentObserver = null;  // so calibrate can access location
let arActive = false;
let deviceAngles = { alpha: 0, beta: 0, gamma: 0 };

let scene, camera, renderer;
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
    renderer = new THREE.WebGLRenderer();
    const controls = new OrbitControls(camera, renderer.domElement);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    camera.position.set(0, 0, 0.1);   // basically at center
    controls.target.set(0, 0, 0);     // look toward center
    controls.rotateSpeed = -0.3;       // negative makes drag feel natural (like looking around)

    function animate() {
        requestAnimationFrame(animate);
      
        if (arActive) {
          const deg2rad = Math.PI / 180;
          const alpha = deviceAngles.alpha * deg2rad;
          const beta  = deviceAngles.beta  * deg2rad;
          const gamma = deviceAngles.gamma * deg2rad;
      
          const euler = new THREE.Euler();
          euler.set(beta, alpha, -gamma, 'YXZ');  // device orientation order
          camera.quaternion.setFromEuler(euler);
        } else {
          controls.update();   // drag controls only when not in AR
        }
      
        renderer.render(scene, camera);
      }
    animate();

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

function startAR() {
    alert('Start AR running');   // proves the button fired
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
      alert('Listener attached (Android path)');  // proves we reached here
    }
}

function onOrientation(event) {
  if (event.alpha === null) return;
  deviceAngles.alpha = event.alpha - headingOffset;
  deviceAngles.beta  = event.beta;
  deviceAngles.gamma = event.gamma;
  arActive = true;
  // keep the readout for now while testing
  document.getElementById('arReadout').textContent =
    `a${event.alpha.toFixed(0)} b${event.beta.toFixed(0)} g${event.gamma.toFixed(0)}`;
}

function calibrateOnMoon() {
    if (!currentObserver) { alert('Find location first'); return; }
  
    const time = new Date();
    // where the Moon really is:
    const equ = Astronomy.Equator(Astronomy.Body.Moon, time, currentObserver, true, true);
    const hor = Astronomy.Horizon(time, currentObserver, equ.ra, equ.dec, 'normal');
    const moonAzimuth = hor.azimuth;   // true compass bearing of the Moon
  
    // what the phone currently thinks it's pointing at (raw alpha, before offset):
    const rawHeading = deviceAngles.alpha + headingOffset; // undo current offset to get raw
  
    // the offset is the difference: how far the phone's heading is from reality
    headingOffset = rawHeading - moonAzimuth;
  
    alert(`Calibrated. Moon az ${moonAzimuth.toFixed(0)}, offset ${headingOffset.toFixed(0)}`);
  }
    
document.getElementById('findBtn').addEventListener('click', FindLocation);
document.getElementById('arBtn').addEventListener('click', startAR);
document.getElementById('calBtn').addEventListener('click', calibrateOnMoon);

loadStars();
loadConstellations();
startScene();