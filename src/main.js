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
  initButtons();
  initCameraOrbit();

  // Start screen
  const startScreen = document.getElementById("start-screen");
  const playBtn = document.getElementById("play-button");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      if (startScreen) startScreen.style.display = "none";
    });
  }

  // Hook up collision, speed, and RPM indicators
  collisionIndicator = document.getElementById("collisionIndicator");
  speedIndicator = document.getElementById("speedIndicator");
  rpmIndicator = document.getElementById("rpmIndicator");

  prevTime = Date.now();
  animate();
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

  // Optional debug axes
  // const axesHelper = new THREE.AxesHelper(5);
  // scene.add(axesHelper);

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
    physicsWorld.addBody(boxBody);

    obstaclesList.push(boxMesh);
    obstacleBodiesList.push(boxBody);
  }
}

// ========== LOAD ROAD ==========
function loadRoad() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "/road.glb", // Path to your road model
    (gltf) => {
      roadMesh = gltf.scene; // A Group or hierarchy
      roadMesh.scale.set(1, 1, 1); // Adjust as needed
      scene.add(roadMesh);

      // Traverse to set shadows
      roadMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Add physics
      addRoadPhysics(roadMesh);
    },
    undefined,
    (error) => {
      console.error("Error loading the road model:", error);
    }
  );
}

// Add physics to each mesh within the road group
function addRoadPhysics(roadGroup) {
  // Create a single compound body for the entire road
  const roadCompoundBody = new CANNON.Body({ mass: 0 });

  roadGroup.traverse((child) => {
    if (child.isMesh && child.geometry) {
      // Ensure world matrix is up to date
      child.updateMatrixWorld(true);

      // Clone the geometry so we can transform it
      const tempGeom = child.geometry.clone();
      // Bake in the mesh's world transform (position/rotation/scale)
      tempGeom.applyMatrix4(child.matrixWorld);

      // Convert geometry to arrays
      const posAttr = tempGeom.attributes.position;
      if (!posAttr) return;

      const vertices = posAttr.array;
      let indices = null;
      if (tempGeom.index) {
        indices = tempGeom.index.array;
      } else {
        // If no index, build a default one
        indices = [];
        for (let i = 0; i < vertices.length / 3; i++) {
          indices.push(i);
        }
      }

      // Create a Trimesh shape
      const roadShape = new CANNON.Trimesh(vertices, indices);
      roadCompoundBody.addShape(roadShape);
    }
  });

  // Finally add the compound road body
  physicsWorld.addBody(roadCompoundBody);
}

// ========== LOAD CAR WITH DRACO ==========
function loadCarWithDraco() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "/car1.glb", // Path to your Draco-compressed GLB
    (gltf) => {
      carMesh = gltf.scene;
      // Scale first, then compute bounding box
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      // Shadows
      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Now compute bounding box after scaling
      const bbox = new THREE.Box3().setFromObject(carMesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);

      // The bottom of the bounding box
      const minY = bbox.min.y;

      // We want the car's bottom to sit at y=0
      const halfExtents = new CANNON.Vec3(
        size.x / 2,
        size.y / 2,
        size.z / 2
      );
      const yOffset = halfExtents.y - minY;

      // Shift the car mesh so bottom is at y=0
      carMesh.position.y += yOffset;

      // Create Cannon box shape matching bounding box
      const shape = new CANNON.Box(halfExtents);

      // Create the body
      carBody = new CANNON.Body({
        mass: 500, // Heavier mass for more stable physics
        shape: shape,
        position: new CANNON.Vec3(0, halfExtents.y, 0),
        linearDamping: 0.2,  // Slight velocity damping
        angularDamping: 0.3, // Slight rotational damping
      });

      // Prevent tipping over: only allow rotation around Y
      carBody.angularFactor.set(0, 1, 0);

      // Collision event
      carBody.addEventListener("collide", onCarCollision);

      // Add to physics
      physicsWorld.addBody(carBody);

      // Sync orientation
      carMesh.position.copy(carBody.position);
      carMesh.quaternion.copy(carBody.quaternion);

      // If model faces -Z, rotate it 180° to face +Z
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
  // Basic red box if loading fails
  const geom = new THREE.BoxGeometry(2, 1, 4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(geom, mat);
  scene.add(carMesh);

  // Compute bounding box for fallback
  const bbox = new THREE.Box3().setFromObject(carMesh);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const minY = bbox.min.y;

  const halfExtents = new CANNON.Vec3(
    size.x / 2,
    size.y / 2,
    size.z / 2
  );
  const yOffset = halfExtents.y - minY;
  carMesh.position.y += yOffset;

  // Cannon shape
  const shape = new CANNON.Box(halfExtents);

  // Create body
  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, halfExtents.y, 0),
    linearDamping: 0.2,
    angularDamping: 0.3,
  });
  carBody.angularFactor.set(0, 1, 0);
  carBody.addEventListener("collide", onCarCollision);
  physicsWorld.addBody(carBody);

  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // Rotate 180° if needed
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
  // console.log("Car collided with body:", e.body?.id);
}

// ========== STEERING ==========
function initSteering() {
  steeringBase = document.getElementById("joystick-base");
  steeringKnob = document.getElementById("joystick-knob");
  if (!steeringBase || !steeringKnob) return;

  // Touch + Mouse events
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

  // Animate knob back to center
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

  // Center of the steering base
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const dx = clientX - cx;
  const dy = clientY - cy;

  // Calculate angle, clamp to -180..180 deg
  let angle = Math.atan2(dy, dx);
  let angleDeg = THREE.MathUtils.radToDeg(angle);
  angleDeg = THREE.MathUtils.clamp(angleDeg, -180, 180);

  // Set knob rotation
  steeringKnob.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;

  // Normalize steering angle between -1..+1
  steeringAngle = angleDeg / 180;
}

// ========== BUTTONS (GAS/BRAKE) ==========
function initButtons() {
  accelButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  if (accelButton) {
    accelButton.addEventListener("mousedown", () => {
      accelInput = true;
    });
    accelButton.addEventListener("mouseup", () => {
      accelInput = false;
    });
    accelButton.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        accelInput = true;
      },
      { passive: false }
    );
    accelButton.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        accelInput = false;
      },
      { passive: false }
    );
  }

  if (brakeButton) {
    brakeButton.addEventListener("mousedown", () => {
      brakeInput = true;
    });
    brakeButton.addEventListener("mouseup", () => {
      brakeInput = false;
    });
    brakeButton.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        brakeInput = true;
      },
      { passive: false }
    );
    brakeButton.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        brakeInput = false;
      },
      { passive: false }
    );
  }
}

// ========== ORBIT CAMERA ==========
function initCameraOrbit() {
  document.addEventListener("mousedown", orbitStart, false);
  document.addEventListener("touchstart", orbitStart, { passive: false });
}

function orbitStart(e) {
  // Ignore UI elements
  const ignoreIds = [
    "joystick-base",
    "joystick-knob",
    "accelerateButton",
    "brakeButton",
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

  // Adjust sensitivity as desired
  orbitAngle += deltaX * -0.3 * (Math.PI / 180);
}

function orbitEnd(e) {
  if (!orbitActiveCamera) return;
  orbitActiveCamera = false;

  document.removeEventListener("mousemove", orbitMove);
  document.removeEventListener("touchmove", orbitMove);
  document.removeEventListener("mouseup", orbitEnd);
  document.removeEventListener("touchend", orbitEnd);

  // Start bounce-back
  orbitAngleOnRelease = orbitAngle;
  orbitLerpStart = Date.now();
  orbitBouncingBack = true;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - prevTime) / 1000; // delta time in seconds
  prevTime = now;

  physicsWorld.step(1 / 60, dt, 3);

  updateCarLogic(dt);
  updateObstacles();
  updateCamera(dt);

  renderer.render(scene, camera);
}

function updateObstacles() {
  // These are static, so no ongoing update needed
}

// ========== CAR LOGIC ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  // 1. Steering
  const currentHeading = getBodyYRot(carBody);
  const targetHeading = steeringAngle * STEER_MAX_ANGLE;
  const diff = targetHeading - currentHeading;
  // Clamp turning speed
  const turn = THREE.MathUtils.clamp(diff, -STEER_RESPONSE * dt, STEER_RESPONSE * dt);
  const newHeading = currentHeading + turn;
  setBodyYRot(carBody, newHeading);

  // 2. Forces for Acceleration & Braking
  const forwardVec = new CANNON.Vec3(
    -Math.sin(newHeading),
    0,
    -Math.cos(newHeading)
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

  // 3. Sync Mesh with Body
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // 4. Update Speed and RPM Indicators
  updateSpeedAndRPM(forwardSpeed);
}

function updateSpeedAndRPM(forwardSpeed) {
  // Convert to km/h
  const speedKmh = Math.abs(forwardSpeed) * 3.6;
  if (speedIndicator) {
    speedIndicator.textContent = `Speed: ${speedKmh.toFixed(1)} km/h`;
  }

  // Simple RPM logic
  let rpm = 800 + 200 * Math.abs(forwardSpeed);
  rpm = Math.floor(rpm);
  if (rpmIndicator) {
    rpmIndicator.textContent = `RPM: ${rpm}`;
  }
}

// ========== CAMERA UPDATE ==========
function updateCamera(dt) {
  if (!carBody) return;

  // Bounce-back if user stopped orbiting
  if (!orbitActiveCamera && orbitBouncingBack) {
    const t = (Date.now() - orbitLerpStart) / 1000; // sec
    const bounceDuration = 1; // sec

    if (t >= bounceDuration) {
      orbitAngle = 0;
      orbitBouncingBack = false;
    } else {
      // Ease out
      const ratio = 1 - Math.pow(1 - t / bounceDuration, 3);
      orbitAngle = THREE.MathUtils.lerp(orbitAngleOnRelease, 0, ratio);
    }
  }

  const heading = getBodyYRot(carBody);
  // Position the camera behind the car
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
  init();
});
