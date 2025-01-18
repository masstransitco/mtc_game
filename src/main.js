/*****************************************************
 * main.js
 * - Bounding-box approach to avoid floating car
 * - Steering wheel ring design
 * - Single-file code
 *****************************************************/

// ========== Imports ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBALS ==========

// Three.js
let scene, camera, renderer;

// Cannon.js
let physicsWorld;

// Car
let carMesh, carBody;

// Steering
let steeringWheelBase, steeringWheelKnob;
let steeringActive = false;
let steeringAngle = 0; // -1..1 normalized
const MAX_STEERING_ANGLE = Math.PI / 4; // ±45°
const STEERING_RESPONSE = 2;           // how quickly heading adjusts

// Buttons (gas/brake)
let accelerateButton, brakeButton;
let accelerateInput = false, brakeInput = false;

// Car driving constants
const ENGINE_FORCE = 1200;
const BRAKE_FORCE = 900;
const MAX_FORWARD_SPEED = 20; // m/s (~72 km/h)
const MAX_REVERSE_SPEED = 5;  // m/s (~18 km/h)

// Additional UI for collisions, speed, rpm
let collisionIndicator;
let speedIndicator, rpmIndicator;

// Orbit camera
let orbitAngle = 0; 
let orbitActive = false;
let orbitBouncingBack = false;
let orbitAngleOnRelease = 0;
let orbitDragStartX = 0;
let orbitLerpStart = 0;
const orbitDistance = 10;
const orbitHeight = 5;

let previousTime = 0;
let animationId = null;

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles();
  // We'll load Draco-compressed model & apply bounding box logic
  loadCarModelWithDraco();

  initSteeringWheel();
  initButtons();
  initCameraOrbitControls();

  // Hide "Start Screen"
  const startScreen = document.getElementById("start-screen");
  const playButton = document.getElementById("play-button");
  if (playButton) {
    playButton.addEventListener("click", () => {
      if (startScreen) startScreen.style.display = "none";
    });
  }

  collisionIndicator = document.getElementById("collisionIndicator");
  speedIndicator = document.getElementById("speedIndicator");
  rpmIndicator = document.getElementById("rpmIndicator");

  previousTime = Date.now();
  animate();
}

// ========== SCENE SETUP ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, -10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 512;
  dirLight.shadow.mapSize.height = 512;
  scene.add(dirLight);

  window.addEventListener("resize", onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== PHYSICS ==========  
function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0)
  });
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.4;

  // Ground plane
  const groundBody = new CANNON.Body({ mass: 0 });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT & OBSTACLES ==========
function initEnvironment() {
  const groundSize = 200;
  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI/2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

let obstacles = [];
let obstacleBodies = [];
function spawnObstacles() {
  // Some sample boxes
  const positions = [
    { x: 0, z: 30 },
    { x: 2, z: 50 },
    { x: -3, z: 70 }
  ];
  for (let p of positions) {
    const size = 2;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const boxMesh = new THREE.Mesh(geo, mat);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.position.set(p.x, size/2, p.z);
    scene.add(boxMesh);

    const shape = new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2));
    const body = new CANNON.Body({ mass: 0, shape: shape });
    body.position.set(p.x, size/2, p.z);
    physicsWorld.addBody(body);

    obstacles.push(boxMesh);
    obstacleBodies.push(body);
  }
}

// ========== LOAD DRACO CAR (Bounding Box approach) ==========
function loadCarModelWithDraco() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "/car1.glb",
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2,2,2);

      // We'll compute bounding box
      // so we can match the shape & position for Cannon
      const box = new THREE.Box3().setFromObject(carMesh);
      const size = new THREE.Vector3();
      box.getSize(size); // e.g. (lengthX, heightY, lengthZ)

      // For a symmetrical car, we expect size.y ~someValue
      // We'll create a Cannon shape matching that size
      const halfExtents = new CANNON.Vec3(
        size.x/2, 
        size.y/2, 
        size.z/2
      );

      // Now we place the car so the bottom sits on y=0
      // If bounding box min corner is at "box.min.y"
      // we can do position.y = -box.min.y * carMesh.scale.y
      // or simpler: just set the body to half of bounding-box height
      // so the bottom is at y=0
      const bottomY = size.y / 2; // half height => placed so that is y
      // we might also consider the box.min.y offset if pivot is not at base

      // Create Cannon body
      const shape = new CANNON.Box(halfExtents);
      carBody = new CANNON.Body({
        mass: 500,
        shape: shape,
        // place so bottom is y=0
        position: new CANNON.Vec3(0, bottomY, 0),
        linearDamping: 0.2,
        angularDamping: 0.3
      });
      // Lock X,Z rotation
      carBody.angularFactor.set(0,1,0);

      // Add collision event
      carBody.addEventListener("collide", handleCarCollision);
      physicsWorld.addBody(carBody);

      // Adjust the mesh so it matches the body
      // i.e. mesh position = body position
      // We'll shift the mesh so its bounding-box bottom is at y=0
      // The bounding box might have an offset if pivot is not at center
      // We'll do a simpler approach:
      carMesh.position.set(0, bottomY, 0);

      // Now add to the scene
      scene.add(carMesh);

      // Ensure all child meshes cast/receive shadows
      carMesh.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    },
    undefined,
    (error) => {
      console.error("Error loading Draco GLB:", error);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  // We'll do a simple bounding-box approach as well
  const fallbackGeom = new THREE.BoxGeometry(2,1,4);
  fallbackGeom.computeBoundingBox();
  const box = fallbackGeom.boundingBox; // min: (-1, -0.5, -2), max: (1,0.5,2)
  const size = new THREE.Vector3();
  box.getSize(size); // (2,1,4)

  // Cannon shape
  const halfExtents = new CANNON.Vec3(size.x/2, size.y/2, size.z/2);
  const bottomY = size.y/2;

  // Cannon body
  const shape = new CANNON.Box(halfExtents);
  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, bottomY, 0),
    linearDamping: 0.2,
    angularDamping: 0.3
  });
  carBody.angularFactor.set(0,1,0);
  carBody.addEventListener("collide", handleCarCollision);
  physicsWorld.addBody(carBody);

  // Three mesh
  carMesh = new THREE.Mesh(fallbackGeom, new THREE.MeshLambertMaterial({ color:0xff0000 }));
  carMesh.position.set(0, bottomY, 0);
  scene.add(carMesh);
}

function handleCarCollision(evt) {
  if (collisionIndicator) {
    collisionIndicator.style.display = "block";
    collisionIndicator.textContent = "Collision!";
    setTimeout(() => {
      collisionIndicator.style.display = "none";
    }, 1000);
  }
  console.log("Car collided with body:", evt.body.id);
}

// ========== STEERING WHEEL RING DESIGN ==========
// We'll interpret ring rotation from -180..+180 => steeringAngle -1..+1
function initSteeringWheel() {
  steeringWheelBase = document.getElementById("joystick-base");
  steeringWheelKnob = document.getElementById("joystick-knob");
  if (!steeringWheelBase || !steeringWheelKnob) return;

  steeringWheelBase.addEventListener("touchstart", onSteeringStart, { passive:false });
  steeringWheelBase.addEventListener("touchmove", onSteeringMove, { passive:false });
  steeringWheelBase.addEventListener("touchend", onSteeringEnd, { passive:false });
  steeringWheelBase.addEventListener("mousedown", onSteeringStart, { passive:false });
  document.addEventListener("mousemove", onSteeringMove, { passive:false });
  document.addEventListener("mouseup", onSteeringEnd, { passive:false });
}

function onSteeringStart(e) {
  e.preventDefault();
  steeringActive = true;
  steeringWheelKnob.classList.add("active");
  updateSteering(e);
}

function onSteeringMove(e) {
  if (!steeringActive) return;
  e.preventDefault();
  updateSteering(e);
}

function onSteeringEnd(e) {
  if (!steeringActive) return;
  e.preventDefault();
  steeringActive = false;
  steeringWheelKnob.classList.remove("active");

  // Animate knob back to center
  steeringWheelKnob.style.transition = "transform 0.3s ease";
  steeringWheelKnob.style.transform = "translate(-50%, -50%) rotate(0deg)";
  setTimeout(() => {
    steeringWheelKnob.style.transition = "none";
    steeringAngle = 0;
  }, 300);
}

function updateSteering(e) {
  const rect = steeringWheelBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches.length>0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const dx = clientX - cx;
  const dy = clientY - cy;

  let angle = Math.atan2(dy, dx);  // -π..+π
  let angleDeg = THREE.MathUtils.radToDeg(angle);
  angleDeg = THREE.MathUtils.clamp(angleDeg, -180, 180);

  steeringWheelKnob.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;

  steeringAngle = angleDeg / 180; // => -1..+1
}

// ========== BUTTONS (Gas + Brake) ==========
function initButtons() {
  accelerateButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  if (accelerateButton) {
    accelerateButton.addEventListener("mousedown", () => (accelerateInput = true));
    accelerateButton.addEventListener("mouseup", () => (accelerateInput = false));
    accelerateButton.addEventListener("touchstart", e => {
      e.preventDefault();
      accelerateInput = true;
    }, { passive:false });
    accelerateButton.addEventListener("touchend", e => {
      e.preventDefault();
      accelerateInput = false;
    }, { passive:false });
  }

  if (brakeButton) {
    brakeButton.addEventListener("mousedown", () => (brakeInput = true));
    brakeButton.addEventListener("mouseup", () => (brakeInput = false));
    brakeButton.addEventListener("touchstart", e => {
      e.preventDefault();
      brakeInput = true;
    }, { passive:false });
    brakeButton.addEventListener("touchend", e => {
      e.preventDefault();
      brakeInput = false;
    }, { passive:false });
  }
}

// ========== ORBIT CAMERA CONTROLS ==========
function initCameraOrbitControls() {
  document.addEventListener("mousedown", orbitStart, false);
  document.addEventListener("touchstart", orbitStart, { passive:false });
}

function orbitStart(e) {
  const ignoreIds = ["joystick-base","joystick-knob","accelerateButton","brakeButton"];
  if (ignoreIds.includes(e.target.id)) return;

  e.preventDefault();
  orbitActive = true;
  orbitBouncingBack = false;

  orbitDragStartX = e.clientX || (e.touches && e.touches[0].clientX);

  document.addEventListener("mousemove", orbitMove, false);
  document.addEventListener("touchmove", orbitMove, { passive:false });
  document.addEventListener("mouseup", orbitEnd, false);
  document.addEventListener("touchend", orbitEnd, { passive:false });
}

function orbitMove(e) {
  if (!orbitActive) return;
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const deltaX = clientX - orbitDragStartX;
  orbitDragStartX = clientX;

  orbitAngle += deltaX * -0.3 * (Math.PI / 180);
}

function orbitEnd(e) {
  if (!orbitActive) return;
  orbitActive = false;

  document.removeEventListener("mousemove", orbitMove);
  document.removeEventListener("touchmove", orbitMove);
  document.removeEventListener("mouseup", orbitEnd);
  document.removeEventListener("touchend", orbitEnd);

  orbitAngleOnRelease = orbitAngle;
  orbitLerpStart = Date.now();
  orbitBouncingBack = true;
}

// ========== MAIN ANIMATION LOOP ==========
function animate() {
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime)/1000;
  previousTime = now;

  physicsWorld.step(1/60, dt, 3);

  updateCarLogic(dt);
  updateObstacles();
  updateCamera(dt);

  renderer.render(scene, camera);
}

function updateObstacles() {
  // static => do nothing
}

// ========== CAR LOGIC ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  // 1) Steering
  const currentHeading = getBodyYRotation(carBody);
  const targetHeading = steeringAngle * MAX_STEERING_ANGLE;
  const diff = targetHeading - currentHeading;
  const turn = THREE.MathUtils.clamp(diff, -STEERING_RESPONSE*dt, STEERING_RESPONSE*dt);
  const newHeading = currentHeading + turn;
  setBodyYRotation(carBody, newHeading);

  // 2) Force for forward/back
  // heading=0 => +Z
  const forwardVec = new CANNON.Vec3(Math.sin(newHeading), 0, Math.cos(newHeading));
  const vel = carBody.velocity.clone();
  const forwardSpeed = vel.dot(forwardVec);

  if (accelerateInput) {
    if (forwardSpeed < MAX_FORWARD_SPEED) {
      const force = forwardVec.scale(ENGINE_FORCE);
      carBody.applyForce(force, carBody.position);
    }
  }
  if (brakeInput) {
    if (forwardSpeed > -MAX_REVERSE_SPEED) {
      const reverseForce = forwardVec.scale(-BRAKE_FORCE);
      carBody.applyForce(reverseForce, carBody.position);
    }
  }

  // 3) Speed limit
  const speedLimit = 50; 
  const curSpeed = carBody.velocity.length();
  if (curSpeed > speedLimit) {
    carBody.velocity.scale(speedLimit / curSpeed, carBody.velocity);
  }

  // 4) Sync mesh
  if (carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }

  // 5) Update speed & rpm
  updateSpeedAndRPM(forwardSpeed);
}

function updateSpeedAndRPM(forwardSpeed) {
  // forwardSpeed in m/s => convert to km/h
  const speedKmh = Math.abs(forwardSpeed)*3.6;

  // Contrived formula for RPM
  let rpm = 800 + 200 * Math.abs(forwardSpeed);
  rpm = Math.floor(rpm);

  if (speedIndicator) {
    speedIndicator.textContent = `Speed: ${speedKmh.toFixed(1)} km/h`;
  }
  if (rpmIndicator) {
    rpmIndicator.textContent = `RPM: ${rpm}`;
  }
}

// ========== CAMERA UPDATE ==========
function updateCamera(dt) {
  if (!carBody) return;

  // bounce back if not orbitActive
  if (!orbitActive && orbitBouncingBack) {
    const t = (Date.now() - orbitLerpStart)/1000;
    const bounceDuration = 1; 
    if (t >= bounceDuration) {
      orbitAngle = 0;
      orbitBouncingBack = false;
    } else {
      const ratio = 1 - Math.pow(1 - t/bounceDuration, 3); // ease out
      orbitAngle = THREE.MathUtils.lerp(orbitAngleOnRelease, 0, ratio);
    }
  }

  const heading = getBodyYRotation(carBody);
  // behind => heading + π
  const baseAngle = heading + Math.PI;
  const camAngle = baseAngle + orbitAngle;

  const carPos = carBody.position;
  const camX = carPos.x + Math.sin(camAngle)*orbitDistance;
  const camZ = carPos.z + Math.cos(camAngle)*orbitDistance;
  const camY = carPos.y + orbitHeight;

  camera.position.set(camX, camY, camZ);
  camera.lookAt(carPos.x, carPos.y, carPos.z);
}

// ========== Helpers: Get/Set Body Y Rotation ==========
function getBodyYRotation(body) {
  const q = body.quaternion;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    "YXZ"
  );
  return euler.y;
}

function setBodyYRotation(body, yRad) {
  const euler = new THREE.Euler(0, yRad, 0, "YXZ");
  const quat = new THREE.Quaternion().setFromEuler(euler);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// ========== STARTUP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
