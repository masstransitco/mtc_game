// ========== Imports ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBALS ==========
let scene, camera, renderer;
let physicsWorld;
let carMesh, carBody;
let joystickBase, joystickKnob;
let joystickActive = false;
let joystickMaxDistance = 0;
let joystickX = 0, joystickY = 0;

let accelerateInput = false;
let decelerateInput = false;
let moveLeft = false;
let moveRight = false;

// We’ll maintain a simple base velocity for forward motion
// and some min/max velocities for demonstration
const baseVelocity = 5;   // ~some baseline speed in +Z
const minVelocity = 1;
const maxVelocity = 20;

let previousTime = 0;
let animationId;

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  loadCarModel();   // or create fallback box

  initJoystick();
  window.addEventListener("resize", onWindowResize, false);

  // Start the render loop once the DOM is ready
  previousTime = Date.now();
  animate();
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB); // light sky

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 5, -15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Add some light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, -10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 512;
  dirLight.shadow.mapSize.height = 512;
  scene.add(dirLight);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physicsWorld.solver.iterations = 10;

  // Create a static plane for the ground
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  // Rotate so plane is horizontal
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

function initEnvironment() {
  // Simple ground plane in Three.js (visual)
  const groundSize = 200;
  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

function loadCarModel() {
  // Option A: Load a GLTF car
  const loader = new GLTFLoader();
  loader.load(
    "/MTC.glb",
    (gltf) => {
      // Simplify the car: just place it above the ground
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Create a simple box shape in Cannon
      const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2)); 
      // Place it so it’s definitely above the ground
      carBody = new CANNON.Body({
        mass: 100, 
        shape: carShape,
        position: new CANNON.Vec3(0, 1.1, 0), 
        linearDamping: 0.3,
        angularDamping: 0.6,
      });
      carBody.fixedRotation = true;
      physicsWorld.addBody(carBody);

      // Align initial position
      carMesh.position.set(0, 1.1, 0);
    },
    undefined,
    (err) => {
      console.error("Error loading MTC.glb:", err);
      // fallback
      createFallbackCar();
    }
  );
}

// or fallback: just a red box if the GLTF fails
function createFallbackCar() {
  const boxGeom = new THREE.BoxGeometry(2, 1, 4);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(boxGeom, boxMat);
  carMesh.castShadow = true;
  scene.add(carMesh);

  // Cannon shape
  const halfExtents = new CANNON.Vec3(1, 0.5, 2);
  carBody = new CANNON.Body({
    mass: 100,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(0, 1.1, 0),
    linearDamping: 0.3,
    angularDamping: 0.6,
  });
  carBody.fixedRotation = true;
  physicsWorld.addBody(carBody);

  carMesh.position.set(0, 1.1, 0);
}

// ========== JOYSTICK SETUP ==========
function initJoystick() {
  joystickBase = document.getElementById("joystick-base");
  joystickKnob = document.getElementById("joystick-knob");
  if (!joystickBase || !joystickKnob) return;

  joystickMaxDistance = joystickBase.offsetWidth / 2;

  // Clean up old events
  joystickBase.removeEventListener("touchstart", onJoystickStart);
  joystickBase.removeEventListener("touchmove", onJoystickMove);
  joystickBase.removeEventListener("touchend", onJoystickEnd);
  joystickBase.removeEventListener("mousedown", onJoystickStart);
  document.removeEventListener("mousemove", onJoystickMove);
  document.removeEventListener("mouseup", onJoystickEnd);

  // Add new events
  joystickBase.addEventListener("touchstart", onJoystickStart, { passive: false });
  joystickBase.addEventListener("touchmove", onJoystickMove, { passive: false });
  joystickBase.addEventListener("touchend", onJoystickEnd, { passive: false });
  joystickBase.addEventListener("mousedown", onJoystickStart, { passive: false });
  document.addEventListener("mousemove", onJoystickMove, { passive: false });
  document.addEventListener("mouseup", onJoystickEnd, { passive: false });
}

function onJoystickStart(e) {
  e.preventDefault();
  joystickActive = true;
  joystickKnob.classList.add("active");
  updateJoystick(e);
}

function onJoystickMove(e) {
  if (!joystickActive) return;
  e.preventDefault();
  updateJoystick(e);
}

function onJoystickEnd(e) {
  if (!joystickActive) return;
  e.preventDefault();
  joystickActive = false;
  joystickKnob.classList.remove("active");

  joystickKnob.style.transition = "transform 0.3s ease";
  joystickKnob.style.transform = "translate(0,0)";
  setTimeout(() => {
    joystickKnob.style.transition = "transform 0.1s ease";
    joystickX = 0;
    joystickY = 0;
  }, 300);

  // Reset inputs
  accelerateInput = false;
  decelerateInput = false;
  moveLeft = false;
  moveRight = false;
}

/**
 * For demonstration:
 * - Pull "down" => we treat that as +Z forward (accelerate)
 * - Pull "up" => -Z (decelerate)
 */
function updateJoystick(e) {
  const rect = joystickBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  const dist = Math.sqrt(x * x + y * y);
  const angle = Math.atan2(y, x);
  const clampedDist = Math.min(dist, joystickMaxDistance);

  joystickX = (clampedDist * Math.cos(angle)) / joystickMaxDistance;
  joystickY = (clampedDist * Math.sin(angle)) / joystickMaxDistance;

  // Move knob
  joystickKnob.style.transform = `translate(${joystickX * joystickMaxDistance * 0.6}px, ${joystickY * joystickMaxDistance * 0.6}px)`;

  const deadZone = 0.2;
  // interpret joystick Y
  accelerateInput = joystickY > deadZone;   // pull downward => accelerate +Z
  decelerateInput = joystickY < -deadZone;  // push upward => decelerate
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  // Step physics
  physicsWorld.step(1 / 60, dt, 3);

  updateLogic(dt);
  renderer.render(scene, camera);
}

function updateLogic(dt) {
  // If we haven't loaded the car yet, skip
  if (!carBody) return;

  // We'll store velocity in a local var
  const vx = carBody.velocity.x;
  let vz = carBody.velocity.z;

  // Move forward/back in +Z/-Z
  if (accelerateInput) {
    // accelerate forward
    vz = Math.min(vz + 10 * dt, maxVelocity);
  } else if (decelerateInput) {
    // decelerate => reduce Z velocity
    vz = Math.max(vz - 10 * dt, minVelocity);
  } else {
    // approach base velocity
    if (vz > baseVelocity) {
      vz -= 2 * dt;
    } else if (vz < baseVelocity) {
      vz += 2 * dt;
    }
  }

  // Side movement
  let newVx = vx;
  if (moveLeft) {
    newVx = -5;
  } else if (moveRight) {
    newVx = 5;
  } else {
    // damp side
    newVx *= 0.9;
    if (Math.abs(newVx) < 0.05) {
      newVx = 0;
    }
  }

  // Assign updated velocities
  carBody.velocity.x = newVx;
  carBody.velocity.z = vz;

  // Sync Three mesh to Cannon body
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // Basic camera follow
  updateCamera();
}

function updateCamera() {
  if (!carBody) return;
  // place camera behind car
  const desiredPos = new THREE.Vector3(
    carBody.position.x,
    5,
    carBody.position.z - 15
  );
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(carBody.position.x, carBody.position.y, carBody.position.z);
}

// ========== STARTUP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
