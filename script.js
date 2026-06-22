import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
            // remove everything except lights/camera helpers; for now remove all meshes
            for (let i = scene.children.length - 1; i >= 0; i--) {
              const obj = scene.children[i];
              if (obj.isMesh) scene.remove(obj);
            }
          }
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
         // build these HERE, then pass them in
        const observer = new Astronomy.Observer(latitude, longitude, 0);
        const time = new Date();
        clearSky();
        plotStars(stars, observer, time);
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
document.getElementById('findBtn').addEventListener('click', FindLocation);

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
        renderer.render(scene, camera);
        controls.update();
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

  function magToSize(mag) {
    // brightest stars big, faint ones tiny, exponential-ish falloff
    // mag -1.5 (Sirius) -> large, mag 4 -> very small
    const size = 1.5 * Math.pow(2.512, (1 - mag) * 0.4);
    return Math.max(0.15, Math.min(size, 4)); // clamp so nothing's absurd
  }

loadStars();
startScene();   