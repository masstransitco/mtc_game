/*****************************************************
 * main.js
 * - Ensures Car Sits on Ground using Bounding Box
 * - Adds a Road with Geometries (Bends and Elevation)
 * - Steering Wheel Ring Design
 * - Applies Forces for Acceleration & Braking
 * - Displays RPM & Speed
 * - Adds Collision Feedback
 *****************************************************/

// ========== Imports ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBAL VARIABLES ==========
let scene, camera, renderer;
let physicsWorld;

// Car
let carMesh, carBody;

// Road
let roadMesh;

// Steering
let steeringBase, steeringKnob;
let steeringActive = false;
let steeringAngle = 0;

// Buttons
let accelButton, brakeButton;
let accelInput = false, brakeInput = false;

// UI Indicators
let collisionIndicator, speedIndicator, rpmIndicator;

// Driving Constants
const ENGINE_FORCE = 1200;
const BRAKE_FORCE = 900;
const MAX_FWD_SPEED = 20; // m/s (~72 km/h)
const MAX_REV_SPEED = 5;  // m/s (~18 km/h)
const STEER_RESPONSE = 2;
const STEER_MAX_ANGLE = Math.PI / 4;

// Orbit Camera Variables
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

// ========== INITIALIZATION ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles();
  createRoad();
  loadCarWithDraco();
  initSteering();
  initButtons();
  initUI();
  initCameraOrbit();
  animate();
}

// ========== SCENE SETUP ==========
function initScene() {
  // Create Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky Blue

  // Create Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, orbitHeight, orbitDistance);
  camera.lookAt(0, 0, 0);

  // Create Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Add Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, -10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  scene.add(directionalLight);

  // Handle Window Resize
  window.addEventListener("resize", onResize, false);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== PHYSICS SETUP ==========
function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.4;

  // Ground Plane (Infinite)
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.collisionResponse = true;
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT SETUP ==========
function initEnvironment() {
  // Ground
  const groundSize = 200;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 }); // Forest Green
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2; // Horizontal
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// ========== ROAD CREATION ==========
function createRoad() {
  const roadWidth = 6;
  const roadLength = 200;
  const segments = 100;

  // Create a Path for the Road with Bends and Elevation
  const path = new THREE.CurvePath();
  const curve1 = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-roadWidth / 2, 0, 0),
    new THREE.Vector3(-roadWidth / 2, 0, roadLength / 4),
    new THREE.Vector3(roadWidth / 2, 0, (roadLength * 3) / 4),
    new THREE.Vector3(roadWidth / 2, 0, roadLength)
  );
  path.add(curve1);

  // Create Road Geometry using TubeGeometry for elevation
  roadMesh = new THREE.TubeGeometry(path, segments, roadWidth / 2, 8, false);
  const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 }); // Dark Gray
  const roadMeshObj = new THREE.Mesh(roadMesh, roadMaterial);
  roadMeshObj.rotation.x = -Math.PI / 2; // Horizontal
  roadMeshObj.receiveShadow = true;
  roadMeshObj.castShadow = true;
  scene.add(roadMeshObj);

  // Add Physics for the Road
  // For simplicity, we'll use multiple CANNON.Plane shapes to approximate the road's surface
  const roadBody = new CANNON.Body({ mass: 0 });
  const roadSegments = 10;
  const segmentLength = roadLength / roadSegments;

  for (let i = 0; i < roadSegments; i++) {
    const planeShape = new CANNON.Plane();
    roadBody.addShape(planeShape, new CANNON.Vec3(0, 0, (i + 0.5) * segmentLength));
  }

  roadBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(roadBody);
}

// ========== OBSTACLE SPAWN ==========
let obstaclesList = [],
  obstacleBodiesList = [];

function spawnObstacles() {
  const obstaclePositions = [
    { x: -5, z: 30 },
    { x: 5, z: 60 },
    { x: -5, z: 90 },
    { x: 5, z: 120 },
    { x: -5, z: 150 },
  ];

  for (let pos of obstaclePositions) {
    const size = 2;
    const boxGeometry = new THREE.BoxGeometry(size, size, size);
    const boxMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 }); // Gray
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.position.set(pos.x, size / 2, pos.z);
    scene.add(boxMesh);

    // Cannon Body for Obstacle
    const boxShape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    const boxBody = new CANNON.Body({ mass: 0, shape: boxShape });
    boxBody.position.set(pos.x, size / 2, pos.z);
    boxBody.collisionResponse = true;
    physicsWorld.addBody(boxBody);

    obstaclesList.push(boxMesh);
    obstacleBodiesList.push(boxBody);
  }
}

// ========== CAR LOADING ==========
function loadCarWithDraco() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("./assets/draco/"); // Ensure Draco files are correctly located
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "/MTC.glb", // Adjusted path
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(carMesh);

      // Calculate Bounding Box for Physics
      const bbox = new THREE.Box3().setFromObject(carMesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);

      const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);

      // Position Car on Ground
      carMesh.position.y = halfExtents.y;
      const shape = new CANNON.Box(halfExtents);

      // Create Car Physics Body
      carBody = new CANNON.Body({
        mass: 500,
        shape: shape,
        position: new CANNON.Vec3(0, halfExtents.y, 0),
        linearDamping: 0.2,
        angularDamping: 0.3,
      });
      carBody.angularFactor.set(0, 1, 0);
      carBody.addEventListener("collide", onCarCollision);
      carBody.collisionResponse = true;
      physicsWorld.addBody(carBody);

      // Sync Mesh with Physics Body
      carMesh.position.copy(carBody.position);
      carMesh.quaternion.copy(carBody.quaternion);

      // Initial Rotation
      carMesh.rotation.y = Math.PI;
      carBody.quaternion.setFromEuler(0, Math.PI, 0, "YXZ");
      carMesh.quaternion.copy(carBody.quaternion);
    },
    undefined,
    (error) => {
      console.error("Error loading car model:", error);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  // Create a simple box as a fallback car
  const geom = new THREE.BoxGeometry(2, 1, 4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(geom, mat);
  scene.add(carMesh);

  const bbox = new THREE.Box3().setFromObject(carMesh);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);

  // Position Car on Ground
  carMesh.position.y = halfExtents.y;
  const shape = new CANNON.Box(halfExtents);

  // Create Car Physics Body
  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, halfExtents.y, 0),
    linearDamping: 0.2,
    angularDamping: 0.3,
  });
  carBody.angularFactor.set(0, 1, 0);
  carBody.addEventListener("collide", onCarCollision);
  carBody.collisionResponse = true;
  physicsWorld.addBody(carBody);

  // Sync Mesh with Physics Body
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // Initial Rotation
  carMesh.rotation.y = Math.PI;
  carBody.quaternion.setFromEuler(0, Math.PI, 0, "YXZ");
  carMesh.quaternion.copy(carBody.quaternion);
}

// ========== COLLISION HANDLING ==========
function onCarCollision(event) {
  if (collisionIndicator) {
    collisionIndicator.style.display = "block";
    collisionIndicator.textContent = "Collision!";
    setTimeout(() => {
      collisionIndicator.style.display = "none";
    }, 1000);
  }
}

// ========== STEERING WHEEL SETUP ==========
function initSteering() {
  steeringBase = document.getElementById("joystick-base");
  steeringKnob = document.getElementById("joystick-knob");
  if (!steeringBase || !steeringKnob) return;

  // Touch Events
  steeringBase.addEventListener("touchstart", onSteerStart, { passive: false });
  steeringBase.addEventListener("touchmove", onSteerMove, { passive: false });
  steeringBase.addEventListener("touchend", onSteerEnd, { passive: false });

  // Mouse Events
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

  // Smoothly reset the steering knob
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

  // Limit the steering angle visually
  angleDeg = THREE.MathUtils.clamp(angleDeg, -90, 90);

  steeringKnob.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
  steeringAngle = angleDeg / 90; // Normalize to -1..+1
}

// ========== BUTTONS SETUP (ACCELERATE & BRAKE) ==========
function initButtons() {
  accelButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  // Accelerate Button Handlers
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

  // Brake Button Handlers
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

// ========== UI INDICATORS ==========
function initUI() {
  collisionIndicator = document.getElementById("collisionIndicator");
  speedIndicator = document.getElementById("speedIndicator");
  rpmIndicator = document.getElementById("rpmIndicator");
}

// ========== ORBIT CAMERA SETUP ==========
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
    "play-button"
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
  orbitAngle += deltaX * -0.003; // Adjust sensitivity as needed
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

  // Step Physics World
  physicsWorld.step(1 / 60, dt, 3);

  // Update Car Logic
  updateCarLogic(dt);

  // Update Camera Position
  updateCamera(dt);

  // Render Scene
  renderer.render(scene, camera);
}

// ========== CAR LOGIC ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  // Steering Logic
  const currentHeading = getBodyYRot(carBody);
  const targetHeading = steeringAngle * STEER_MAX_ANGLE;
  const headingDiff = targetHeading - currentHeading;
  const turn = THREE.MathUtils.clamp(headingDiff, -STEER_RESPONSE * dt, STEER_RESPONSE * dt);
  const newHeading = currentHeading + turn;
  setBodyYRot(carBody, newHeading);

  // Forward Vector Calculation
  const forwardVec = new CANNON.Vec3(
    Math.sin(newHeading),
    0,
    Math.cos(newHeading)
  );

  const velocity = carBody.velocity.clone();
  const forwardSpeed = velocity.dot(forwardVec);

  // Apply Acceleration
  if (accelInput && forwardSpeed < MAX_FWD_SPEED) {
    const force = forwardVec.scale(ENGINE_FORCE);
    carBody.applyForce(force, carBody.position);
  }

  // Apply Braking/Reverse
  if (brakeInput && forwardSpeed > -MAX_REV_SPEED) {
    const brakeForce = forwardVec.scale(-BRAKE_FORCE);
    carBody.applyForce(brakeForce, carBody.position);
  }

  // Sync Mesh with Physics Body
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // Update Speed and RPM Indicators
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
    const bounceDuration = 1; // seconds

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
document.addEventListener("DOMContentLoaded", () => {
  const startScreen = document.getElementById("start-screen");
  const playBtn = document.getElementById("play-button");

  if (playBtn) {
    const handleStart = (e) => {
      e.preventDefault();
      if (startScreen) {
        startScreen.style.display = "none";
      }
      init();
    };

    playBtn.addEventListener("click", handleStart);
    playBtn.addEventListener("touchstart", handleStart, { passive: false });
  } else {
    // If no start screen, initialize directly
    init();
  }

  // Set initial time
  prevTime = Date.now();
});
