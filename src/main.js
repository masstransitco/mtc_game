/*****************************************************
 * main.js
 * Force-based Car + Steering Wheel + Orbit Camera
 *****************************************************/

// ========== Imports (ES Modules) ==========
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
let joystickBase, joystickKnob;
let steeringWheelActive = false;
let steeringAngle = 0; // -1..+1 normalized
const MAX_STEERING_ANGLE = Math.PI / 4; // ~±45°
const STEERING_RESPONSE = 2;           // how quickly heading adjusts

// Buttons (gas / brake)
let accelerateButton, brakeButton;
let accelerateInput = false;
let brakeInput = false;

// Car driving constants
const ENGINE_FORCE = 1200;
const BRAKE_FORCE = 900;
const MAX_FORWARD_SPEED = 20; // m/s (~72 km/h)
const MAX_REVERSE_SPEED = 5;  // m/s (~18 km/h)

// Physics stepping
let previousTime = 0;
let animationId = null;

// Collision UI
let collisionIndicator;

// ========== Camera Orbit ==========
// Let the user orbit camera around the car by pointer-drag anywhere (not on joystick/buttons).
// Then automatically bounce back behind the car.
let orbitAngle = 0;         // camera orbit angle around Y
let orbitActive = false;    // user dragging
let orbitBouncingBack = false;
let orbitAngleOnRelease = 0;
let orbitDragStartX = 0;
let orbitLerpStart = 0;

const orbitDistance = 10;   // how far camera is from car horizontally
const orbitHeight = 5;      // camera height above car

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles();
  loadCarModelWithDraco();

  initSteeringWheelJoystick();
  initButtons();
  initCameraOrbitControls();

  // Hide Start Screen on "Play"
  const startScreen = document.getElementById("start-screen");
  const playButton = document.getElementById("play-button");
  if (playButton) {
    playButton.addEventListener("click", () => {
      if (startScreen) {
        startScreen.style.display = "none";
      }
    });
  }

  // Collision indicator
  collisionIndicator = document.getElementById("collisionIndicator");

  // Start animation
  previousTime = Date.now();
  animate();
}

// ========== SCENE ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  // We'll place it behind the car in updateCamera()

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

  window.addEventListener("resize", onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== PHYSICS ==========
function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.4;

  // Ground plane
  const groundBody = new CANNON.Body({ mass: 0 });
  groundBody.addShape(new CANNON.Plane());
  // rotate so plane is horizontal
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT & OBSTACLES ==========
function initEnvironment() {
  // Large plane
  const groundSize = 200;
  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

let obstacles = [];
let obstacleBodies = [];
function spawnObstacles() {
  // Some boxes so user can see movement
  const positions = [
    { x: 0, z: 30 },
    { x: 2, z: 50 },
    { x: -3, z: 70 }
  ];
  for (let p of positions) {
    const size = 2;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(p.x, size/2, p.z);
    scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2));
    const body = new CANNON.Body({ mass: 0, shape: shape });
    body.position.set(p.x, size/2, p.z);
    physicsWorld.addBody(body);

    obstacles.push(mesh);
    obstacleBodies.push(body);
  }
}

// ========== LOAD DRACO CAR ==========
function loadCarModelWithDraco() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "/car1.glb",
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      carMesh.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 1m tall => halfExtents.y=0.5 => place at y=0.51
      const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
      carBody = new CANNON.Body({
        mass: 500,
        shape: carShape,
        position: new CANNON.Vec3(0, 0.51, 0),
        linearDamping: 0.2,
        angularDamping: 0.3
      });
      // Lock X,Z rotation
      carBody.angularFactor.set(0, 1, 0);

      carBody.addEventListener("collide", handleCarCollision);

      physicsWorld.addBody(carBody);
      carMesh.position.set(0, 0.51, 0);
    },
    undefined,
    (error) => {
      console.error("Error loading Draco GLB:", error);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  const geom = new THREE.BoxGeometry(2,1,4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(geom, mat);
  scene.add(carMesh);

  const shape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, 0.51, 0),
    linearDamping: 0.2,
    angularDamping: 0.3
  });
  carBody.angularFactor.set(0, 1, 0);
  carBody.addEventListener("collide", handleCarCollision);

  physicsWorld.addBody(carBody);

  carMesh.position.set(0, 0.51, 0);
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

// ========== STEERING WHEEL JOYSTICK ==========
// Interprets user ring rotation as -180..+180 => steeringAngle -1..+1
function initSteeringWheelJoystick() {
  joystickBase = document.getElementById("joystick-base");
  joystickKnob = document.getElementById("joystick-knob");
  if (!joystickBase || !joystickKnob) return;

  joystickBase.addEventListener("touchstart", onSteeringWheelStart, { passive: false });
  joystickBase.addEventListener("touchmove", onSteeringWheelMove, { passive: false });
  joystickBase.addEventListener("touchend", onSteeringWheelEnd, { passive: false });
  joystickBase.addEventListener("mousedown", onSteeringWheelStart, { passive: false });
  document.addEventListener("mousemove", onSteeringWheelMove, { passive: false });
  document.addEventListener("mouseup", onSteeringWheelEnd, { passive: false });
}

function onSteeringWheelStart(e) {
  e.preventDefault();
  steeringWheelActive = true;
  joystickKnob.classList.add("active");
  updateSteeringWheel(e);
}

function onSteeringWheelMove(e) {
  if (!steeringWheelActive) return;
  e.preventDefault();

  const rect = joystickBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  let angle = Math.atan2(dy, dx); // -π..π
  let angleDeg = THREE.MathUtils.radToDeg(angle);

  // clamp -180..180
  angleDeg = THREE.MathUtils.clamp(angleDeg, -180, 180);

  // Move knob
  // We offset knob by -50% so it stays centered
  joystickKnob.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;

  // Convert deg => -1..+1
  steeringAngle = angleDeg / 180;
}

function onSteeringWheelEnd(e) {
  if (!steeringWheelActive) return;
  e.preventDefault();
  steeringWheelActive = false;
  joystickKnob.classList.remove("active");

  // Return to center
  joystickKnob.style.transition = "transform 0.3s ease";
  joystickKnob.style.transform = "translate(-50%, -50%) rotate(0deg)";
  setTimeout(() => {
    joystickKnob.style.transition = "none";
    steeringAngle = 0;
  }, 300);
}

// ========== BUTTONS (Accelerate / Brake) ==========
function initButtons() {
  accelerateButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  if (accelerateButton) {
    accelerateButton.addEventListener("mousedown", () => (accelerateInput = true));
    accelerateButton.addEventListener("mouseup", () => (accelerateInput = false));
    accelerateButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      accelerateInput = true;
    }, { passive: false });
    accelerateButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      accelerateInput = false;
    }, { passive: false });
  }

  if (brakeButton) {
    brakeButton.addEventListener("mousedown", () => (brakeInput = true));
    brakeButton.addEventListener("mouseup", () => (brakeInput = false));
    brakeButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      brakeInput = true;
    }, { passive: false });
    brakeButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      brakeInput = false;
    }, { passive: false });
  }
}

// ========== ORBIT CAMERA CONTROLS ==========
// We'll let user drag anywhere that's not the joystick or buttons => orbit the camera.
function initCameraOrbitControls() {
  document.addEventListener("mousedown", orbitStart, false);
  document.addEventListener("touchstart", orbitStart, { passive: false });
}

function orbitStart(e) {
  // If user is on joystick or buttons, ignore
  const ignoreIds = ["joystick-base", "joystick-knob", "accelerateButton", "brakeButton"];
  if (ignoreIds.includes(e.target.id)) return;

  e.preventDefault();
  orbitActive = true;
  orbitBouncingBack = false;

  orbitDragStartX = e.clientX || (e.touches && e.touches[0].clientX);

  document.addEventListener("mousemove", orbitMove, false);
  document.addEventListener("touchmove", orbitMove, { passive: false });
  document.addEventListener("mouseup", orbitEnd, false);
  document.addEventListener("touchend", orbitEnd, { passive: false });
}

function orbitMove(e) {
  if (!orbitActive) return;
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const deltaX = clientX - orbitDragStartX;
  orbitDragStartX = clientX;

  // Negative to rotate in a typical direction
  orbitAngle += deltaX * -0.3 * (Math.PI / 180);
}

function orbitEnd(e) {
  if (!orbitActive) return;
  orbitActive = false;

  document.removeEventListener("mousemove", orbitMove);
  document.removeEventListener("touchmove", orbitMove);
  document.removeEventListener("mouseup", orbitEnd);
  document.removeEventListener("touchend", orbitEnd);

  // bounce back
  orbitAngleOnRelease = orbitAngle;
  orbitLerpStart = Date.now();
  orbitBouncingBack = true;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  physicsWorld.step(1 / 60, dt, 3);

  updateCarLogic(dt);
  updateObstacles();
  updateCamera(dt);

  renderer.render(scene, camera);
}

// If obstacles are dynamic, sync them here
function updateObstacles() {
  // ours are static
}

// ========== CAR LOGIC ==========
// heading=0 => facing +Z
function updateCarLogic(dt) {
  if (!carBody) return;

  // 1) Steering => read current Y rotation, lerp to target
  const currentHeading = getBodyYRotation(carBody);
  const targetHeading = steeringAngle * MAX_STEERING_ANGLE;
  const diff = targetHeading - currentHeading;
  const turn = THREE.MathUtils.clamp(diff, -STEERING_RESPONSE*dt, STEERING_RESPONSE*dt);
  const newHeading = currentHeading + turn;
  setBodyYRotation(carBody, newHeading);

  // 2) Forward/Backward force
  // heading=0 => forward is +Z => let's define forwardVec
  const forwardVec = new CANNON.Vec3(Math.sin(newHeading), 0, Math.cos(newHeading));
  const vel = carBody.velocity.clone();
  const forwardSpeed = vel.dot(forwardVec);

  // Gas
  if (accelerateInput) {
    if (forwardSpeed < MAX_FORWARD_SPEED) {
      const force = forwardVec.scale(ENGINE_FORCE);
      carBody.applyForce(force, carBody.position);
    }
  }
  // Brake / Reverse
  if (brakeInput) {
    if (forwardSpeed > -MAX_REVERSE_SPEED) {
      const reverseForce = forwardVec.scale(-BRAKE_FORCE);
      carBody.applyForce(reverseForce, carBody.position);
    }
  }

  // (Optional) clamp extremely large speeds
  const speedLimit = 50;
  const curSpeed = carBody.velocity.length();
  if (curSpeed > speedLimit) {
    carBody.velocity.scale(speedLimit / curSpeed, carBody.velocity);
  }

  // Sync mesh
  if (carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }
}

// ========== CAMERA UPDATE ==========
function updateCamera(dt) {
  if (!carBody) return;

  // bounce back if not orbitActive
  if (!orbitActive && orbitBouncingBack) {
    const t = (Date.now() - orbitLerpStart) / 1000;
    const bounceDuration = 1; // 1s
    if (t >= bounceDuration) {
      orbitAngle = 0;
      orbitBouncingBack = false;
    } else {
      // ease out
      const ratio = 1 - Math.pow(1 - t/bounceDuration, 3);
      orbitAngle = THREE.MathUtils.lerp(orbitAngleOnRelease, 0, ratio);
    }
  }

  // The camera angle around the car => (car heading + π) + orbitAngle
  const heading = getBodyYRotation(carBody);
  const baseAngle = heading + Math.PI;  // behind the car
  const camAngle = baseAngle + orbitAngle;

  // Position camera at some distance behind & above the car
  const carPos = carBody.position;
  const camX = carPos.x + Math.sin(camAngle)*orbitDistance;
  const camZ = carPos.z + Math.cos(camAngle)*orbitDistance;
  const camY = carPos.y + orbitHeight;

  camera.position.set(camX, camY, camZ);
  camera.lookAt(carPos.x, carPos.y, carPos.z);
}

// ========== HELPERS for Body Y Rotation ==========
function getBodyYRotation(body) {
  // read yaw from quaternion
  const q = body.quaternion;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    "YXZ"
  );
  return euler.y;
}

function setBodyYRotation(body, yRad) {
  // set yaw only
  const euler = new THREE.Euler(0, yRad, 0, "YXZ");
  const quat = new THREE.Quaternion().setFromEuler(euler);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// ========== STARTUP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
