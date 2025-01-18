/*****************************************************
 * main.js
 * - Ensures Car Sits on Ground using Bounding Box
 * - Adds a Road with Bends and Elevation
 * - Steering Wheel Ring Design
 * - Applies Forces for Acceleration & Braking
 * - Displays RPM & Speed
 * - Adds Collision Feedback
 *****************************************************/

// ========== Imports (ES Modules) ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBALS ==========

// Basic
let scene, camera, renderer;
let physicsWorld;

// Car
let carMesh, carBody;

// Road
let roadMesh; // Will be a THREE.Group or mesh hierarchy

// Steering ring
let steeringBase, steeringKnob;
let steeringActive = false; // - indicates if user is steering
let steeringAngle = 0;      // -1..+1 range

// Buttons
let accelButton, brakeButton;
let accelInput = false, brakeInput = false;

// UI
let collisionIndicator, speedIndicator, rpmIndicator;

// Driving constants
const ENGINE_FORCE = 1200;
const BRAKE_FORCE = 900;
const MAX_FWD_SPEED = 20; // m/s (~72 km/h)
const MAX_REV_SPEED = 5;  // m/s (~18 km/h)
const STEER_RESPONSE = 2;
const STEER_MAX_ANGLE = Math.PI / 4;

// Orbit
let orbitAngle = 0;
let orbitActiveCamera = false;
let orbitBouncingBack = false;
let orbitAngleOnRelease = 0;
let orbitDragStartX = 0;
let orbitLerpStart = 0;
const orbitDistance = 10;
const orbitHeight = 5;

// Timing
let prevTime = 0;
let animId = null;

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles();
  loadRoad();
  loadCarWithDraco();
  initSteering();
  initCameraOrbit();
}

// ========== SCENE ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky Blue

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 5, 10); // Initial camera position

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, -10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  scene.add(directionalLight);

  window.addEventListener("resize", onResize, false);
}

function onResize() {
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

  // Ground plane (infinite)
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  // Rotate to make it horizontal
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.collisionResponse = true; // Fix: Enable collision response
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT ==========
function initEnvironment() {
  const groundSize = 200;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 }); // Forest Green
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2; // Make horizontal
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// ========== OBSTACLES ==========
let obstaclesList = [],
  obstacleBodiesList = [];

function spawnObstacles() {
  const positions = [
    { x: 0, z: 30 },
    { x: 2, z: 50 },
    { x: -3, z: 70 },
    { x: 5, z: 90 },
    { x: -5, z: 110 },
  ];
  for (let p of positions) {
    const size = 2;
    const boxGeometry = new THREE.BoxGeometry(size, size, size);
    const boxMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 }); // Gray
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.position.set(p.x, size / 2, p.z);
    scene.add(boxMesh);

    // Cannon Body
    const boxShape = new CANNON.Box(
      new CANNON.Vec3(size / 2, size / 2, size / 2)
    );
    const boxBody = new CANNON.Body({ mass: 0, shape: boxShape });
    boxBody.position.set(p.x, size / 2, p.z);
    boxBody.collisionResponse = true; // Fix: Enable collision response
    physicsWorld.addBody(boxBody);

    obstaclesList.push(boxMesh);
    obstacleBodiesList.push(boxBody);
  }
}

// ========== LOAD ROAD ==========
function loadRoad() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  // Fix: Update Draco decoder path to correct location
  dracoLoader.setDecoderPath("./assets/draco/"); // Assuming draco files are in assets/draco/
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "./assets/models/road.glb", // Fix: Update path to correct location
    (gltf) => {
      roadMesh = gltf.scene;
      roadMesh.scale.set(1, 1, 1);
      scene.add(roadMesh);

      roadMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      addRoadPhysics(roadMesh);
    },
    undefined,
    (error) => {
      console.error("Error loading the road model:", error);
    }
  );
}

function addRoadPhysics(roadGroup) {
  const roadCompoundBody = new CANNON.Body({ mass: 0 });
  roadCompoundBody.collisionResponse = true; // Fix: Enable collision response

  roadGroup.traverse((child) => {
    if (child.isMesh && child.geometry) {
      child.updateMatrixWorld(true);
      const tempGeom = child.geometry.clone();
      tempGeom.applyMatrix4(child.matrixWorld);

      const posAttr = tempGeom.attributes.position;
      if (!posAttr) return;

      const vertices = posAttr.array;
      let indices = null;
      if (tempGeom.index) {
        indices = tempGeom.index.array;
      } else {
        indices = [];
        for (let i = 0; i < vertices.length / 3; i++) {
          indices.push(i);
        }
      }

      const roadShape = new CANNON.Trimesh(vertices, indices);
      roadCompoundBody.addShape(roadShape);
    }
  });

  physicsWorld.addBody(roadCompoundBody);
}

// ========== LOAD CAR WITH DRACO ==========
function loadCarWithDraco() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  // Fix: Update Draco decoder path
  dracoLoader.setDecoderPath("./assets/draco/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "./assets/models/car1.glb", // Fix: Update path to correct location
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const bbox = new THREE.Box3().setFromObject(carMesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);

      const halfExtents = new CANNON.Vec3(
        size.x / 2,
        size.y / 2,
        size.z / 2
      );

      // Fix: Set absolute position instead of offset
      carMesh.position.y = halfExtents.y;

      const shape = new CANNON.Box(halfExtents);

      carBody = new CANNON.Body({
        mass: 500,
        shape: shape,
        position: new CANNON.Vec3(0, halfExtents.y, 0),
        linearDamping: 0.2,
        angularDamping: 0.3,
      });

      carBody.angularFactor.set(0, 1, 0);
      carBody.addEventListener("collide", onCarCollision);
      carBody.collisionResponse = true; // Fix: Enable collision response
      physicsWorld.addBody(carBody);

      carMesh.position.copy(carBody.position);
      carMesh.quaternion.copy(carBody.quaternion);

      carMesh.rotation.y = Math.PI;
      carBody.quaternion.setFromEuler(0, Math.PI, 0, "YXZ");
      carMesh.quaternion.copy(carBody.quaternion);
    },
    undefined,
    (error) => {
      console.error("Error loading Draco GLB:", error);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  const geom = new THREE.BoxGeometry(2, 1, 4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(geom, mat);
  scene.add(carMesh);

  const bbox = new THREE.Box3().setFromObject(carMesh);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const halfExtents = new CANNON.Vec3(
    size.x / 2,
    size.y / 2,
    size.z / 2
  );

  // Fix: Set absolute position instead of offset
  carMesh.position.y = halfExtents.y;

  const shape = new CANNON.Box(halfExtents);

  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, halfExtents.y, 0),
    linearDamping: 0.2,
    angularDamping: 0.3,
  });
  carBody.angularFactor.set(0, 1, 0);
  carBody.addEventListener("collide", onCarCollision);
  carBody.collisionResponse = true; // Fix: Enable collision response
  physicsWorld.addBody(carBody);

  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  carMesh.rotation.y = Math.PI;
  carBody.quaternion.setFromEuler(0, Math.PI, 0, "YXZ");
  carMesh.quaternion.copy(carBody.quaternion);
}

function onCarCollision(e) {
  if (collisionIndicator) {
    collisionIndicator.style.display = "block";
    collisionIndicator.textContent = "Collision!";
    setTimeout(() => {
      collisionIndicator.style.display = "none";
    }, 1000);
  }
}

// ========== STEERING ==========
function initSteering() {
  steeringBase = document.getElementById("joystick-base");
  steeringKnob = document.getElementById("joystick-knob");
  if (!steeringBase || !steeringKnob) return;

  steeringBase.addEventListener("touchstart", onSteerStart, { passive: false });
  steeringBase.addEventListener("touchmove", onSteerMove, { passive: false });
  steeringBase.addEventListener("touchend", onSteerEnd, { passive: false });

  steeringBase.addEventListener("mousedown", onSteerStart, { passive: false });
  document.addEventListener("mousemove", onSteerMove, { passive: false });
  document.addEventListener("mouseup", onSteerEnd, { passive: false });
}

function onSteerStart(e) {
  e.preventDefault();
  steeringActive = true;
  steeringKnob.classList.add("active");
  updateSteer(e);
}

function onSteerMove(e) {
  if (!steeringActive) return;
  e.preventDefault();
  updateSteer(e);
}

function onSteerEnd(e) {
  if (!steeringActive) return;
  e.preventDefault();
  steeringActive = false;
  steeringKnob.classList.remove("active");

  steeringKnob.style.transition = "transform 0.3s ease";
  steeringKnob.style.transform = "translate(-50%, -50%) rotate(0deg)";

  setTimeout(() => {
    steeringKnob.style.transition = "none";
    steeringAngle = 0;
  }, 300);
}

function updateSteer(e) {
  const rect = steeringBase.getBoundingClientRect();
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

  let angle = Math.atan2(dy, dx);
  let angleDeg = THREE.MathUtils.radToDeg(angle);
  angleDeg = THREE.MathUtils.clamp(angleDeg, -180, 180);

  steeringKnob.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
  steeringAngle = angleDeg / 180;
}

// ========== BUTTONS (GAS/BRAKE) ==========
// Fix: Initialize buttons during DOM content loaded
function initButtons() {
  // Get button elements
  accelButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  // Fix: Add touch and click handlers with proper checks
  if (accelButton) {
    const handleAccelStart = (e) => {
      e.preventDefault();
      accelInput = true;
      accelButton.classList.add('active');
    };

    const handleAccelEnd = (e) => {
      e.preventDefault();
      accelInput = false;
      accelButton.classList.remove('active');
    };

    accelButton.addEventListener("mousedown", handleAccelStart);
    accelButton.addEventListener("mouseup", handleAccelEnd);
    accelButton.addEventListener("mouseleave", handleAccelEnd);
    accelButton.addEventListener("touchstart", handleAccelStart, { passive: false });
    accelButton.addEventListener("touchend", handleAccelEnd, { passive: false });
    accelButton.addEventListener("touchcancel", handleAccelEnd, { passive: false });
  }

  if (brakeButton) {
    const handleBrakeStart = (e) => {
      e.preventDefault();
      brakeInput = true;
      brakeButton.classList.add('active');
    };

    const handleBrakeEnd = (e) => {
      e.preventDefault();
      brakeInput = false;
      brakeButton.classList.remove('active');
    };

    brakeButton.addEventListener("mousedown", handleBrakeStart);
    brakeButton.addEventListener("mouseup", handleBrakeEnd);
    brakeButton.addEventListener("mouseleave", handleBrakeEnd);
    brakeButton.addEventListener("touchstart", handleBrakeStart, { passive: false });
    brakeButton.addEventListener("touchend", handleBrakeEnd, { passive: false });
    brakeButton.addEventListener("touchcancel", handleBrakeEnd, { passive: false });
  }
}

// ========== ORBIT CAMERA ==========
function initCameraOrbit() {
  document.addEventListener("mousedown", orbitStart, false);
  document.addEventListener("touchstart", orbitStart, { passive: false });
}

function orbitStart(e) {
  const ignoreIds = [
    "joystick-base",
    "joystick-knob",
    "accelerateButton",
    "brakeButton",
    "play-button" // Fix: Add play button to ignore list
  ];
  if (ignoreIds.includes(e.target.id)) return;

  e.preventDefault();
  orbitActiveCamera = true;
  orbitBouncingBack = false;
  orbitDragStartX = e.clientX || (e.touches && e.touches[0].clientX);

  document.addEventListener("mousemove", orbitMove, false);
  document.addEventListener("touchmove", orbitMove, { passive: false });
  document.addEventListener("mouseup", orbitEnd, false);
  document.addEventListener("touchend", orbitEnd, { passive: false });
}

function orbitMove(e) {
  if (!orbitActiveCamera) return;
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const deltaX = clientX - orbitDragStartX;
  orbitDragStartX = clientX;
  orbitAngle += deltaX * -0.3 * (Math.PI / 180);
}

function orbitEnd(e) {
  if (!orbitActiveCamera) return;
  orbitActiveCamera = false;

  document.removeEventListener("mousemove", orbitMove);
  document.removeEventListener("touchmove", orbitMove);
  document.removeEventListener("mouseup", orbitEnd);
  document.removeEventListener("touchend", orbitEnd);

  orbitAngleOnRelease = orbitAngle;
  orbitLerpStart = Date.now();
  orbitBouncingBack = true;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - prevTime) / 1000;
  prevTime = now;

  physicsWorld.step(1 / 60, dt, 3);

  updateCarLogic(dt);
  updateObstacles();
  updateCamera(dt);

  renderer.render(scene, camera);
}

function updateObstacles() {
  // Static obstacles, no updates needed
}

// ========== CAR LOGIC ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  // Steering
  const currentHeading = getBodyYRot(carBody);
  const targetHeading = steeringAngle * STEER_MAX_ANGLE;
  const diff = targetHeading - currentHeading;
  const turn = THREE.MathUtils.clamp(diff, -STEER_RESPONSE * dt, STEER_RESPONSE * dt);
  const newHeading = currentHeading + turn;
  setBodyYRot(carBody, newHeading);

  // Fix: Correct forward vector calculation
  const forwardVec = new CANNON.Vec3(
    Math.sin(newHeading),
    0,
    Math.cos(newHeading)
  );

  const vel = carBody.velocity.clone();
  const forwardSpeed = vel.dot(forwardVec);

  // Accelerate if under max forward speed
  if (accelInput && forwardSpeed < MAX_FWD_SPEED) {
    const force = forwardVec.scale(ENGINE_FORCE);
    carBody.applyForce(force, carBody.position);
  }

  // Brake / Reverse if above max reverse speed
  if (brakeInput && forwardSpeed > -MAX_REV_SPEED) {
    const brakeForce = forwardVec.scale(-BRAKE_FORCE);
    carBody.applyForce(brakeForce, carBody.position);
  }

  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  updateSpeedAndRPM(forwardSpeed);
}

function updateSpeedAndRPM(forwardSpeed) {
  const speedKmh = Math.abs(forwardSpeed) * 3.6;
  if (speedIndicator) {
    speedIndicator.textContent = `Speed: ${speedKmh.toFixed(1)} km/h`;
  }

  let rpm = 800 + 200 * Math.abs(forwardSpeed);
  rpm = Math.floor(rpm);
  if (rpmIndicator) {
    rpmIndicator.textContent = `RPM: ${rpm}`;
  }
}

// ========== CAMERA UPDATE ==========
function updateCamera(dt) {
  if (!carBody) return;

  if (!orbitActiveCamera && orbitBouncingBack) {
    const t = (Date.now() - orbitLerpStart) / 1000;
    const bounceDuration = 1;

    if (t >= bounceDuration) {
      orbitAngle = 0;
      orbitBouncingBack = false;
    } else {
      const ratio = 1 - Math.pow(1 - t / bounceDuration, 3);
      orbitAngle = THREE.MathUtils.lerp(orbitAngleOnRelease, 0, ratio);
    }
  }

  const heading = getBodyYRot(carBody);
  const baseAngle = heading + Math.PI;
  const camAngle = baseAngle + orbitAngle;

  const carPos = carBody.position;
  const camX = carPos.x + Math.sin(camAngle) * orbitDistance;
  const camZ = carPos.z + Math.cos(camAngle) * orbitDistance;
  const camY = carPos.y + orbitHeight;

  camera.position.set(camX, camY, camZ);
  camera.lookAt(carPos.x, carPos.y, carPos.z);
}

// ========== HELPER FUNCTIONS ==========
function getBodyYRot(body) {
  const q = body.quaternion;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    "YXZ"
  );
  return euler.y;
}

function setBodyYRot(body, yRad) {
  const euler = new THREE.Euler(0, yRad, 0, "YXZ");
  const quat = new THREE.Quaternion().setFromEuler(euler);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// ========== STARTUP ==========
// Fix: Properly handle DOM loading and play button
document.addEventListener("DOMContentLoaded", () => {
  const startScreen = document.getElementById("start-screen");
  const playBtn = document.getElementById("play-button");

  if (playBtn) {
    const handleStart = (e) => {
      e.preventDefault();
      if (startScreen) {
        startScreen.style.display = "none";
      }
      // Initialize game after play button pressed
      init();
      initButtons(); // Fix: Initialize buttons after DOM is ready
    };

    playBtn.addEventListener("click", handleStart);
    playBtn.addEventListener("touchstart", handleStart, { passive: false });
  } else {
    // No start screen, init directly
    init();
    initButtons();
  }

  // Set initial time
  prevTime = Date.now();
});