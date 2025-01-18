/*****************************************************
 * main.js
 * A guaranteed approach to place the car flush on ground:
 *  - Exactly matches bounding box min.y to 0 in Three.js
 *  - Positions Cannon body so the bottom = y=0
 *  - Steering wheel ring, accelerate/brake, speed & rpm
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

// Steering ring
let steeringBase, steeringKnob;
let steeringActive = false;
let steeringAngle = 0; // -1..+1

// Buttons
let accelButton, brakeButton;
let accelInput = false, brakeInput = false;

// UI
let collisionIndicator, speedIndicator, rpmIndicator;

// Driving constants
const ENGINE_FORCE = 1200;
const BRAKE_FORCE = 900;
const MAX_FWD_SPEED = 20;
const MAX_REV_SPEED = 5;
const STEER_RESPONSE = 2;
const STEER_MAX_ANGLE = Math.PI / 4;

// Orbit
let orbitAngle = 0;
let orbitActive = false;
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

  collisionIndicator = document.getElementById("collisionIndicator");
  speedIndicator = document.getElementById("speedIndicator");
  rpmIndicator = document.getElementById("rpmIndicator");

  prevTime = Date.now();
  animate();
}

// ========== SCENE ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 500);
  
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10,20,-10);
  dirLight.castShadow = true;
  scene.add(dirLight);

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

  // Ground plane
  const groundBody = new CANNON.Body({mass:0});
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  // rotate horizontal
  groundBody.quaternion.setFromEuler(-Math.PI/2,0,0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT ========== 
function initEnvironment() {
  const gSize = 200;
  const gGeom = new THREE.PlaneGeometry(gSize,gSize);
  const gMat = new THREE.MeshLambertMaterial({color:0x228b22});
  const ground = new THREE.Mesh(gGeom,gMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// Obstacles
let obstacles = [], obstacleBodies=[];
function spawnObstacles() {
  const positions = [
    {x:0,z:30},
    {x:2,z:50},
    {x:-3,z:70},
  ];
  for (let p of positions) {
    const size=2;
    const boxGeom = new THREE.BoxGeometry(size,size,size);
    const boxMat = new THREE.MeshLambertMaterial({color:0x888888});
    const boxMesh = new THREE.Mesh(boxGeom, boxMat);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.position.set(p.x, size/2, p.z);
    scene.add(boxMesh);

    // Cannon
    const shape = new CANNON.Box(new CANNON.Vec3(size/2,size/2,size/2));
    const body = new CANNON.Body({mass:0, shape});
    body.position.set(p.x, size/2, p.z);
    physicsWorld.addBody(body);

    obstacles.push(boxMesh);
    obstacleBodies.push(body);
  }
}

// ========== LOAD CAR WITH DRACO ==========
function loadCarWithDraco() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  loader.setDRACOLoader(draco);

  loader.load("/car1.glb",
    (gltf)=>{
      carMesh = gltf.scene;
      carMesh.scale.set(2,2,2);
      scene.add(carMesh);

      // Shadows
      carMesh.traverse(c=>{
        if (c.isMesh) {
          c.castShadow=true;
          c.receiveShadow=true;
        }
      });

      // bounding box
      const bbox = new THREE.Box3().setFromObject(carMesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      console.log("Car bounding size:", size);

      // get minY
      const minY = bbox.min.y;
      console.log("Car bounding minY:", minY);

      // shift mesh so minY=0
      carMesh.position.y -= minY;

      // half extents
      const halfExt = new CANNON.Vec3(size.x/2, size.y/2, size.z/2);

      // create shape
      const shape = new CANNON.Box(halfExt);

      // create body
      carBody = new CANNON.Body({
        mass:500,
        shape,
        position:new CANNON.Vec3(0, halfExt.y, 0),
        linearDamping:0.2,
        angularDamping:0.3,
      });
      // no tip
      carBody.angularFactor.set(0,1,0);

      carBody.addEventListener("collide", onCarCollision);
      physicsWorld.addBody(carBody);

      // sync
      carMesh.position.copy(carBody.position);
      carMesh.quaternion.copy(carBody.quaternion);

      // If model faces -Z, rotate 180 to face +Z
      carMesh.rotation.y = Math.PI;
      carBody.quaternion.setFromEuler(0,Math.PI,0,"YXZ");
      carMesh.quaternion.copy(carBody.quaternion);

      console.log("Car loaded & positioned");
    },
    undefined,
    err=>{
      console.error("Error loading Draco GLB:",err);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  const geom = new THREE.BoxGeometry(2,1,4);
  const mat = new THREE.MeshLambertMaterial({color:0xff0000});
  carMesh = new THREE.Mesh(geom,mat);
  scene.add(carMesh);

  // bounding box
  const bbox=new THREE.Box3().setFromObject(carMesh);
  const size=new THREE.Vector3();
  bbox.getSize(size);
  const minY = bbox.min.y;
  carMesh.position.y -= minY;

  const halfExt = new CANNON.Vec3(size.x/2,size.y/2,size.z/2);
  const shape=new CANNON.Box(halfExt);

  carBody = new CANNON.Body({
    mass:500,
    shape,
    position:new CANNON.Vec3(0,halfExt.y,0),
    linearDamping:0.2,
    angularDamping:0.3
  });
  carBody.angularFactor.set(0,1,0);
  carBody.addEventListener("collide", onCarCollision);
  physicsWorld.addBody(carBody);

  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // rotate 180 if needed
  carMesh.rotation.y = Math.PI;
  carBody.quaternion.setFromEuler(0,Math.PI,0,"YXZ");
  carMesh.quaternion.copy(carBody.quaternion);

  console.log("Fallback Car loaded & positioned");
}

function onCarCollision(e) {
  if (collisionIndicator) {
    collisionIndicator.style.display="block";
    collisionIndicator.textContent="Collision!";
    setTimeout(()=>{collisionIndicator.style.display="none"},1000);
  }
  console.log("Car collided with body:", e.body.id);
}

// ========== STEERING ==========
function initSteering() {
  steeringBase = document.getElementById("joystick-base");
  steeringKnob = document.getElementById("joystick-knob");
  if (!steeringBase||!steeringKnob) return;

  steeringBase.addEventListener("touchstart", onSteerStart, {passive:false});
  steeringBase.addEventListener("touchmove", onSteerMove, {passive:false});
  steeringBase.addEventListener("touchend", onSteerEnd, {passive:false});
  steeringBase.addEventListener("mousedown", onSteerStart, {passive:false});
  document.addEventListener("mousemove", onSteerMove, {passive:false});
  document.addEventListener("mouseup", onSteerEnd, {passive:false});
}

let steeringActive = false;
function onSteerStart(e) {
  e.preventDefault();
  steeringActive = true;
  steeringKnob.classList.add("active");
  updateSteer(e);
}
function onSteerMove(e) {
  if(!steeringActive)return;
  e.preventDefault();
  updateSteer(e);
}
function onSteerEnd(e) {
  if(!steeringActive)return;
  e.preventDefault();
  steeringActive=false;
  steeringKnob.classList.remove("active");

  steeringKnob.style.transition="transform 0.3s ease";
  steeringKnob.style.transform="translate(-50%,-50%) rotate(0deg)";
  setTimeout(()=>{
    steeringKnob.style.transition="none";
    steeringAngle=0;
  },300);
}
function updateSteer(e) {
  const rect=steeringBase.getBoundingClientRect();
  let clientX, clientY;
  if(e.touches&&e.touches.length>0){
    clientX=e.touches[0].clientX;
    clientY=e.touches[0].clientY;
  } else {
    clientX=e.clientX;
    clientY=e.clientY;
  }

  const cx=rect.left+rect.width/2;
  const cy=rect.top+rect.height/2;
  const dx=clientX-cx;
  const dy=clientY-cy;
  let angle = Math.atan2(dy, dx);
  let deg = THREE.MathUtils.radToDeg(angle);
  deg = THREE.MathUtils.clamp(deg,-180,180);

  steeringKnob.style.transform=`translate(-50%,-50%) rotate(${deg}deg)`;
  steeringAngle=deg/180; // -1..+1
}

// ========== BUTTONS (GAS/BRAKE) ==========
function initButtons() {
  accelButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  if (accelButton) {
    accelButton.addEventListener("mousedown", ()=>{accelInput=true;console.log("Gas pressed");});
    accelButton.addEventListener("mouseup", ()=>{accelInput=false;console.log("Gas released");});
    accelButton.addEventListener("touchstart",(e)=>{
      e.preventDefault();
      accelInput=true;console.log("Gas pressed(touch)");
    },{passive:false});
    accelButton.addEventListener("touchend",(e)=>{
      e.preventDefault();
      accelInput=false;console.log("Gas released(touch)");
    },{passive:false});
  }

  if(brakeButton) {
    brakeButton.addEventListener("mousedown",()=>{brakeInput=true;console.log("Brake pressed");});
    brakeButton.addEventListener("mouseup",()=>{brakeInput=false;console.log("Brake released");});
    brakeButton.addEventListener("touchstart",(e)=>{
      e.preventDefault();
      brakeInput=true;console.log("Brake pressed(touch)");
    },{passive:false});
    brakeButton.addEventListener("touchend",(e)=>{
      e.preventDefault();
      brakeInput=false;console.log("Brake released(touch)");
    },{passive:false});
  }
}

// ========== ORBIT CAMERA ==========
function initCameraOrbit() {
  document.addEventListener("mousedown", orbitStart, false);
  document.addEventListener("touchstart", orbitStart, {passive:false});
}

function orbitStart(e) {
  const ignore=["joystick-base","joystick-knob","accelerateButton","brakeButton"];
  if(ignore.includes(e.target.id))return;

  e.preventDefault();
  orbitActive=true;
  orbitBouncingBack=false;
  
  orbitDragStartX=e.clientX||(e.touches&&e.touches[0].clientX);

  document.addEventListener("mousemove", orbitMove, false);
  document.addEventListener("touchmove", orbitMove, {passive:false});
  document.addEventListener("mouseup", orbitEnd, false);
  document.addEventListener("touchend", orbitEnd, {passive:false});
}

function orbitMove(e) {
  if(!orbitActive)return;
  const clientX=e.clientX||(e.touches&&e.touches[0].clientX);
  const dx=clientX-orbitDragStartX;
  orbitDragStartX=clientX;
  orbitAngle += dx * -0.3 * (Math.PI/180);
}

function orbitEnd(e) {
  if(!orbitActive)return;
  orbitActive=false;

  document.removeEventListener("mousemove", orbitMove);
  document.removeEventListener("touchmove", orbitMove);
  document.removeEventListener("mouseup", orbitEnd);
  document.removeEventListener("touchend", orbitEnd);

  orbitAngleOnRelease=orbitAngle;
  orbitLerpStart=Date.now();
  orbitBouncingBack=true;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animId=requestAnimationFrame(animate);

  const now=Date.now();
  const dt=(now-prevTime)/1000;
  prevTime=now;

  physicsWorld.step(1/60, dt, 3);

  updateCarLogic(dt);
  updateObstacles();
  updateCamera(dt);

  renderer.render(scene, camera);
}

function updateObstacles() {
  // static
}

// ========== CAR LOGIC ==========

function updateCarLogic(dt) {
  if(!carBody)return;

  // Steering
  let currHeading=getBodyYRot(carBody);
  let target=steeringAngle*STEER_MAX_ANGLE;
  let diff=target-currHeading;
  let turn=THREE.MathUtils.clamp(diff, -STEER_RESPONSE*dt, STEER_RESPONSE*dt);
  let newHead=currHeading+turn;
  setBodyYRot(carBody, newHead);

  // forwardVec
  const forwardVec=new CANNON.Vec3(Math.sin(newHead),0,Math.cos(newHead));
  let vel=carBody.velocity.clone();
  let fwdSpeed=vel.dot(forwardVec);

  // Gas
  if(accelInput) {
    if(fwdSpeed<MAX_FWD_SPEED) {
      let force=forwardVec.scale(ENGINE_FORCE);
      carBody.applyForce(force, carBody.position);
      console.log("Accelerating force:", force.toString());
    }
  }
  // Brake
  if(brakeInput) {
    if(fwdSpeed > -MAX_REV_SPEED) {
      let brakeForce=forwardVec.scale(-BRAKE_FORCE);
      carBody.applyForce(brakeForce, carBody.position);
      console.log("Braking force:", brakeForce.toString());
    }
  }

  // limit speed
  let limit=50;
  let spd=carBody.velocity.length();
  if(spd>limit) {
    carBody.velocity.scale(limit/spd, carBody.velocity);
  }

  // sync mesh
  if(carMesh){
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }

  // speed & rpm
  updateSpeedAndRPM(fwdSpeed);
}

function updateSpeedAndRPM(fwdSpeed) {
  const spdKmh=Math.abs(fwdSpeed)*3.6;
  if(speedIndicator) speedIndicator.textContent=`Speed: ${spdKmh.toFixed(1)} km/h`;

  // rpm
  let rpm=800+200*Math.abs(fwdSpeed);
  rpm=Math.floor(rpm);
  if(rpmIndicator) rpmIndicator.textContent=`RPM: ${rpm}`;
}

// ========== CAMERA UPDATE ==========
function updateCamera(dt) {
  if(!carBody)return;

  if(!orbitActive && orbitBouncingBack) {
    let t=(Date.now()-orbitLerpStart)/1000;
    let dur=1;
    if(t>=dur) {
      orbitAngle=0;
      orbitBouncingBack=false;
    } else {
      let ratio=1-Math.pow(1-t/dur,3);
      orbitAngle=THREE.MathUtils.lerp(orbitAngleOnRelease,0,ratio);
    }
  }

  let heading=getBodyYRot(carBody);
  let base=heading+Math.PI;
  let camAng=base+orbitAngle;

  let cpos=carBody.position;
  let camX=cpos.x+Math.sin(camAng)*orbitDistance;
  let camZ=cpos.z+Math.cos(camAng)*orbitDistance;
  let camY=cpos.y+orbitHeight;

  camera.position.set(camX,camY,camZ);
  camera.lookAt(cpos.x,cpos.y,cpos.z);
}

// ========== HELPERS ==========

function getBodyYRot(body) {
  let q=body.quaternion;
  let e=new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w),"YXZ");
  return e.y;
}
function setBodyYRot(body,yRot) {
  let e=new THREE.Euler(0,yRot,0,"YXZ");
  let q=new THREE.Quaternion().setFromEuler(e);
  body.quaternion.set(q.x,q.y,q.z,q.w);
}

// ========== STARTUP ==========
document.addEventListener("DOMContentLoaded",()=>{
  init();
});
