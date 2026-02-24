// DK AS 로그인 배경 - Neural Network (Three.js)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.getElementById('neural-network-canvas');
if (!canvas) throw new Error('Canvas not found');

const overlay = document.getElementById('loginOverlay');
const isMobile = /Mobi|Android/i.test(navigator.userAgent);

const colorPalettes = [
    [new THREE.Color(0x667eea), new THREE.Color(0x764ba2), new THREE.Color(0xf093fb), new THREE.Color(0x9d50bb), new THREE.Color(0x6e48aa)],
    [new THREE.Color(0xf857a6), new THREE.Color(0xff5858), new THREE.Color(0xfeca57), new THREE.Color(0xff6348), new THREE.Color(0xff9068)],
    [new THREE.Color(0x4facfe), new THREE.Color(0x00f2fe), new THREE.Color(0x43e97b), new THREE.Color(0x38f9d7), new THREE.Color(0x4484ce)]
];
let activePaletteIndex = 0;
let currentFormation = 0;
const densityFactor = isMobile ? 0.6 : 1.0;

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.002);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 80); // 멀리서 시작
const cameraTarget = new THREE.Vector3(0, 8, 28); // 최종 위치
const zoomDuration = 3.0; // 줌인 시간(초)
let zoomStartTime = -1;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setClearColor(0x000000);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Starfield
function createStarfield() {
    const count = isMobile ? 4000 : 8000;
    const positions = [], colors = [], sizes = [];
    for (let i = 0; i < count; i++) {
        const r = THREE.MathUtils.randFloat(50, 150);
        const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
        const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
        positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
        const c = Math.random();
        if (c < 0.7) colors.push(1, 1, 1);
        else if (c < 0.85) colors.push(0.7, 0.8, 1);
        else colors.push(1, 0.9, 0.8);
        sizes.push(THREE.MathUtils.randFloat(0.1, 0.3));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
            attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uTime;
            void main() {
                vColor = color;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                float twinkle = sin(uTime * 2.0 + position.x * 100.0) * 0.3 + 0.7;
                gl_PointSize = size * twinkle * (300.0 / -mv.z);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                if (d > 0.5) discard;
                gl_FragColor = vec4(vColor, (1.0 - smoothstep(0.0, 0.5, d)) * 0.8);
            }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    return new THREE.Points(geo, mat);
}
const starField = createStarfield();
scene.add(starField);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.rotateSpeed = 0.6;
controls.minDistance = 8;
controls.maxDistance = 80;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.2;
controls.enablePan = false;

// Bloom
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    isMobile ? 1.2 : 1.8, 0.6, 0.7
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Pulse uniforms
const pulseUniforms = {
    uTime: { value: 0 },
    uPulsePositions: { value: [new THREE.Vector3(1e3,1e3,1e3), new THREE.Vector3(1e3,1e3,1e3), new THREE.Vector3(1e3,1e3,1e3)] },
    uPulseTimes: { value: [-1e3, -1e3, -1e3] },
    uPulseColors: { value: [new THREE.Color(1,1,1), new THREE.Color(1,1,1), new THREE.Color(1,1,1)] },
    uPulseSpeed: { value: 18.0 },
    uBaseNodeSize: { value: 0.6 }
};

// Noise GLSL
const noiseFunctions = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

// Node shader
const nodeShader = {
    vertexShader: `${noiseFunctions}
    attribute float nodeSize;attribute float nodeType;attribute vec3 nodeColor;attribute float distanceFromRoot;
    uniform float uTime;uniform vec3 uPulsePositions[3];uniform float uPulseTimes[3];uniform float uPulseSpeed;uniform float uBaseNodeSize;
    varying vec3 vColor;varying float vNodeType;varying vec3 vPosition;varying float vPulseIntensity;varying float vDistanceFromRoot;varying float vGlow;
    float getPulse(vec3 wp,vec3 pp,float pt){
        if(pt<0.0)return 0.0;float t=uTime-pt;if(t<0.0||t>4.0)return 0.0;
        float pr=t*uPulseSpeed;float d=distance(wp,pp);
        return smoothstep(3.0,0.0,abs(d-pr))*smoothstep(4.0,0.0,t);
    }
    void main(){
        vNodeType=nodeType;vColor=nodeColor;vDistanceFromRoot=distanceFromRoot;
        vec3 wp=(modelMatrix*vec4(position,1.0)).xyz;vPosition=wp;
        float pi=0.0;for(int i=0;i<3;i++)pi+=getPulse(wp,uPulsePositions[i],uPulseTimes[i]);
        vPulseIntensity=min(pi,1.0);
        float breathe=sin(uTime*0.7+distanceFromRoot*0.15)*0.15+0.85;
        float sz=nodeSize*breathe*(1.0+vPulseIntensity*2.5);
        vGlow=0.5+0.5*sin(uTime*0.5+distanceFromRoot*0.2);
        vec3 mp=position;
        if(nodeType>0.5){float n=snoise(position*0.08+uTime*0.08);mp+=normal*n*0.15;}
        vec4 mv=modelViewMatrix*vec4(mp,1.0);
        gl_PointSize=sz*uBaseNodeSize*(1000.0/-mv.z);
        gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader: `
    uniform float uTime;uniform vec3 uPulseColors[3];
    varying vec3 vColor;varying float vNodeType;varying vec3 vPosition;varying float vPulseIntensity;varying float vDistanceFromRoot;varying float vGlow;
    void main(){
        vec2 c=2.0*gl_PointCoord-1.0;float d=length(c);if(d>1.0)discard;
        float g1=1.0-smoothstep(0.0,0.5,d);float g2=1.0-smoothstep(0.0,1.0,d);
        float gs=pow(g1,1.2)+g2*0.3;
        float bc=0.9+0.1*sin(uTime*0.6+vDistanceFromRoot*0.25);
        vec3 fc=vColor*bc;
        if(vPulseIntensity>0.0){
            vec3 pc=mix(vec3(1.0),uPulseColors[0],0.4);
            fc=mix(fc,pc,vPulseIntensity*0.8);fc*=(1.0+vPulseIntensity*1.2);gs*=(1.0+vPulseIntensity);
        }
        fc+=vec3(1.0)*smoothstep(0.4,0.0,d)*0.3;
        float a=gs*(0.95-0.3*d);
        float df=smoothstep(100.0,15.0,length(vPosition-cameraPosition));
        if(vNodeType>0.5){fc*=1.1;a*=0.9;}
        fc*=(1.0+vGlow*0.1);
        gl_FragColor=vec4(fc,a*df);
    }`
};

// Connection shader
const connectionShader = {
    vertexShader: `${noiseFunctions}
    attribute vec3 startPoint;attribute vec3 endPoint;attribute float connectionStrength;attribute float pathIndex;attribute vec3 connectionColor;
    uniform float uTime;uniform vec3 uPulsePositions[3];uniform float uPulseTimes[3];uniform float uPulseSpeed;
    varying vec3 vColor;varying float vCS;varying float vPI;varying float vPP;varying float vDC;
    float getPulse(vec3 wp,vec3 pp,float pt){
        if(pt<0.0)return 0.0;float t=uTime-pt;if(t<0.0||t>4.0)return 0.0;
        float pr=t*uPulseSpeed;float d=distance(wp,pp);
        return smoothstep(3.0,0.0,abs(d-pr))*smoothstep(4.0,0.0,t);
    }
    void main(){
        float t=position.x;vPP=t;
        vec3 mid=mix(startPoint,endPoint,0.5);
        float off=sin(t*3.14159)*0.15;
        vec3 perp=normalize(cross(normalize(endPoint-startPoint),vec3(0.0,1.0,0.0)));
        if(length(perp)<0.1)perp=vec3(1.0,0.0,0.0);
        mid+=perp*off;
        vec3 p0=mix(startPoint,mid,t);vec3 p1=mix(mid,endPoint,t);
        vec3 fp=mix(p0,p1,t);
        float n=snoise(vec3(pathIndex*0.08,t*0.6,uTime*0.15));
        fp+=perp*n*0.12;
        vec3 wp=(modelMatrix*vec4(fp,1.0)).xyz;
        float pi=0.0;for(int i=0;i<3;i++)pi+=getPulse(wp,uPulsePositions[i],uPulseTimes[i]);
        vPI=min(pi,1.0);vColor=connectionColor;vCS=connectionStrength;
        vDC=length(wp-cameraPosition);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(fp,1.0);
    }`,
    fragmentShader: `
    uniform float uTime;uniform vec3 uPulseColors[3];
    varying vec3 vColor;varying float vCS;varying float vPI;varying float vPP;varying float vDC;
    void main(){
        float f1=sin(vPP*25.0-uTime*4.0)*0.5+0.5;
        float f2=sin(vPP*15.0-uTime*2.5+1.57)*0.5+0.5;
        float cf=(f1+f2*0.5)/1.5;
        vec3 bc=vColor*(0.8+0.2*sin(uTime*0.6+vPP*12.0));
        float fi=0.4*cf*vCS;
        vec3 fc=bc;
        if(vPI>0.0){
            vec3 pc=mix(vec3(1.0),uPulseColors[0],0.3);
            fc=mix(bc,pc*1.2,vPI*0.7);fi+=vPI*0.8;
        }
        fc*=(0.7+fi+vCS*0.5);
        float a=0.7*vCS+cf*0.3;
        a=mix(a,min(1.0,a*2.5),vPI);
        gl_FragColor=vec4(fc,a*smoothstep(100.0,15.0,vDC));
    }`
};

// Node class
class Node {
    constructor(pos, level = 0, type = 0) {
        this.position = pos;
        this.connections = [];
        this.level = level;
        this.type = type;
        this.size = type === 0 ? THREE.MathUtils.randFloat(0.8, 1.4) : THREE.MathUtils.randFloat(0.5, 1.0);
        this.distanceFromRoot = 0;
    }
    addConnection(node, strength = 1.0) {
        if (!this.isConnectedTo(node)) {
            this.connections.push({ node, strength });
            node.connections.push({ node: this, strength });
        }
    }
    isConnectedTo(node) {
        return this.connections.some(c => c.node === node);
    }
}

// Network generation
function generateNeuralNetwork(formIdx, df = 1.0) {
    let nodes = [];
    let rootNode;

    function genSphere() {
        rootNode = new Node(new THREE.Vector3(0, 0, 0), 0, 0);
        rootNode.size = 2.0; nodes.push(rootNode);
        const gr = (1 + Math.sqrt(5)) / 2;
        for (let layer = 1; layer <= 5; layer++) {
            const radius = layer * 4;
            const num = Math.floor(layer * 12 * df);
            for (let i = 0; i < num; i++) {
                const phi = Math.acos(1 - 2 * (i + 0.5) / num);
                const theta = 2 * Math.PI * i / gr;
                const pos = new THREE.Vector3(radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi));
                const node = new Node(pos, layer, (layer === 5 || Math.random() < 0.3) ? 1 : 0);
                node.distanceFromRoot = radius; nodes.push(node);
                if (layer > 1) {
                    const prev = nodes.filter(n => n.level === layer - 1 && n !== rootNode)
                        .sort((a, b) => pos.distanceTo(a.position) - pos.distanceTo(b.position));
                    for (let j = 0; j < Math.min(3, prev.length); j++) {
                        node.addConnection(prev[j], Math.max(0.3, 1.0 - pos.distanceTo(prev[j].position) / (radius * 2)));
                    }
                } else { rootNode.addConnection(node, 0.9); }
            }
            const ln = nodes.filter(n => n.level === layer && n !== rootNode);
            for (const node of ln) {
                const nearby = ln.filter(n => n !== node).sort((a, b) => node.position.distanceTo(a.position) - node.position.distanceTo(b.position)).slice(0, 5);
                for (const nn of nearby) {
                    if (node.position.distanceTo(nn.position) < radius * 0.8 && !node.isConnectedTo(nn)) node.addConnection(nn, 0.6);
                }
            }
        }
        const outer = nodes.filter(n => n.level >= 3);
        for (let i = 0; i < Math.min(20, outer.length); i++) {
            const n1 = outer[Math.floor(Math.random() * outer.length)];
            const n2 = outer[Math.floor(Math.random() * outer.length)];
            if (n1 !== n2 && !n1.isConnectedTo(n2) && Math.abs(n1.level - n2.level) > 1) n1.addConnection(n2, 0.4);
        }
    }

    function genHelix() {
        rootNode = new Node(new THREE.Vector3(0, 0, 0), 0, 0);
        rootNode.size = 1.8; nodes.push(rootNode);
        const helixArrays = [];
        for (let h = 0; h < 4; h++) {
            const phase = (h / 4) * Math.PI * 2;
            const hn = [];
            const nph = Math.floor(50 * df);
            for (let i = 0; i < nph; i++) {
                const t = i / (nph - 1);
                const y = (t - 0.5) * 30;
                const rs = Math.sin(t * Math.PI) * 0.7 + 0.3;
                const r = 12 * rs;
                const angle = phase + t * Math.PI * 6;
                const pos = new THREE.Vector3(r * Math.cos(angle), y, r * Math.sin(angle));
                const node = new Node(pos, Math.ceil(t * 5), (i > nph - 5 || Math.random() < 0.25) ? 1 : 0);
                node.distanceFromRoot = Math.sqrt(r * r + y * y);
                nodes.push(node); hn.push(node);
            }
            helixArrays.push(hn);
            rootNode.addConnection(hn[0], 1.0);
            for (let i = 0; i < hn.length - 1; i++) hn[i].addConnection(hn[i + 1], 0.85);
        }
        for (let h = 0; h < 4; h++) {
            const cur = helixArrays[h], next = helixArrays[(h + 1) % 4];
            for (let i = 0; i < cur.length; i += 5) {
                const idx = Math.round((i / (cur.length - 1)) * (next.length - 1));
                if (idx < next.length) cur[i].addConnection(next[idx], 0.7);
            }
        }
        const all = nodes.filter(n => n !== rootNode);
        for (let i = 0; i < Math.floor(30 * df); i++) {
            const n1 = all[Math.floor(Math.random() * all.length)];
            const nearby = all.filter(n => { const d = n.position.distanceTo(n1.position); return n !== n1 && d < 8 && d > 3 && !n1.isConnectedTo(n); });
            if (nearby.length > 0) n1.addConnection(nearby[Math.floor(Math.random() * nearby.length)], 0.45);
        }
    }

    function genFractal() {
        rootNode = new Node(new THREE.Vector3(0, 0, 0), 0, 0);
        rootNode.size = 1.6; nodes.push(rootNode);
        function branch(start, dir, depth, str, scale) {
            if (depth > 4) return;
            const endPos = new THREE.Vector3().copy(start.position).add(dir.clone().multiplyScalar(5 * scale));
            const node = new Node(endPos, depth, (depth === 4 || Math.random() < 0.3) ? 1 : 0);
            node.distanceFromRoot = rootNode.position.distanceTo(endPos);
            nodes.push(node); start.addConnection(node, str);
            if (depth < 4) {
                for (let i = 0; i < 3; i++) {
                    const angle = (i / 3) * Math.PI * 2;
                    const p1 = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
                    const p2 = dir.clone().cross(p1).normalize();
                    const nd = new THREE.Vector3().copy(dir).add(p1.clone().multiplyScalar(Math.cos(angle) * 0.7)).add(p2.clone().multiplyScalar(Math.sin(angle) * 0.7)).normalize();
                    branch(node, nd, depth + 1, str * 0.7, scale * 0.75);
                }
            }
        }
        for (let i = 0; i < 6; i++) {
            const phi = Math.acos(1 - 2 * (i + 0.5) / 6);
            const theta = Math.PI * (1 + Math.sqrt(5)) * i;
            branch(rootNode, new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)).normalize(), 1, 0.9, 1.0);
        }
        const leafs = nodes.filter(n => n.level >= 2);
        for (const node of leafs) {
            const nearby = leafs.filter(n => { const d = n.position.distanceTo(node.position); return n !== node && d < 10 && !node.isConnectedTo(n); })
                .sort((a, b) => node.position.distanceTo(a.position) - node.position.distanceTo(b.position)).slice(0, 3);
            for (const nn of nearby) { if (Math.random() < 0.5 * df) node.addConnection(nn, 0.5); }
        }
    }

    switch (formIdx % 3) {
        case 0: genSphere(); break;
        case 1: genHelix(); break;
        case 2: genFractal(); break;
    }
    return { nodes, rootNode };
}

// Visualization
let neuralNetwork = null, nodesMesh = null, connectionsMesh = null;

function createVisualization(formIdx) {
    if (nodesMesh) { scene.remove(nodesMesh); nodesMesh.geometry.dispose(); nodesMesh.material.dispose(); }
    if (connectionsMesh) { scene.remove(connectionsMesh); connectionsMesh.geometry.dispose(); connectionsMesh.material.dispose(); }

    neuralNetwork = generateNeuralNetwork(formIdx, densityFactor);
    if (!neuralNetwork || neuralNetwork.nodes.length === 0) return;

    const palette = colorPalettes[activePaletteIndex];

    // Nodes
    const nPos = [], nTypes = [], nSizes = [], nColors = [], nDists = [];
    neuralNetwork.nodes.forEach(node => {
        nPos.push(node.position.x, node.position.y, node.position.z);
        nTypes.push(node.type); nSizes.push(node.size); nDists.push(node.distanceFromRoot);
        const bc = palette[Math.min(node.level, palette.length - 1) % palette.length].clone();
        bc.offsetHSL(THREE.MathUtils.randFloatSpread(0.03), THREE.MathUtils.randFloatSpread(0.08), THREE.MathUtils.randFloatSpread(0.08));
        nColors.push(bc.r, bc.g, bc.b);
    });
    const nGeo = new THREE.BufferGeometry();
    nGeo.setAttribute('position', new THREE.Float32BufferAttribute(nPos, 3));
    nGeo.setAttribute('nodeType', new THREE.Float32BufferAttribute(nTypes, 1));
    nGeo.setAttribute('nodeSize', new THREE.Float32BufferAttribute(nSizes, 1));
    nGeo.setAttribute('nodeColor', new THREE.Float32BufferAttribute(nColors, 3));
    nGeo.setAttribute('distanceFromRoot', new THREE.Float32BufferAttribute(nDists, 1));
    const nMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(pulseUniforms),
        vertexShader: nodeShader.vertexShader, fragmentShader: nodeShader.fragmentShader,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    nodesMesh = new THREE.Points(nGeo, nMat);
    scene.add(nodesMesh);

    // Connections
    const cPos = [], cStart = [], cEnd = [], cStrength = [], cColors = [], cPathIdx = [];
    const processed = new Set();
    let pIdx = 0;
    neuralNetwork.nodes.forEach((node, ni) => {
        node.connections.forEach(conn => {
            const ci = neuralNetwork.nodes.indexOf(conn.node);
            if (ci === -1) return;
            const key = Math.min(ni, ci) + '-' + Math.max(ni, ci);
            if (processed.has(key)) return;
            processed.add(key);
            const sp = node.position, ep = conn.node.position;
            for (let i = 0; i < 20; i++) {
                cPos.push(i / 19, 0, 0);
                cStart.push(sp.x, sp.y, sp.z); cEnd.push(ep.x, ep.y, ep.z);
                cPathIdx.push(pIdx); cStrength.push(conn.strength);
                const bc = palette[Math.min(Math.floor((node.level + conn.node.level) / 2), palette.length - 1) % palette.length].clone();
                bc.offsetHSL(THREE.MathUtils.randFloatSpread(0.03), THREE.MathUtils.randFloatSpread(0.08), THREE.MathUtils.randFloatSpread(0.08));
                cColors.push(bc.r, bc.g, bc.b);
            }
            pIdx++;
        });
    });
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
    cGeo.setAttribute('startPoint', new THREE.Float32BufferAttribute(cStart, 3));
    cGeo.setAttribute('endPoint', new THREE.Float32BufferAttribute(cEnd, 3));
    cGeo.setAttribute('connectionStrength', new THREE.Float32BufferAttribute(cStrength, 1));
    cGeo.setAttribute('connectionColor', new THREE.Float32BufferAttribute(cColors, 3));
    cGeo.setAttribute('pathIndex', new THREE.Float32BufferAttribute(cPathIdx, 1));
    const cMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(pulseUniforms),
        vertexShader: connectionShader.vertexShader, fragmentShader: connectionShader.fragmentShader,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    connectionsMesh = new THREE.LineSegments(cGeo, cMat);
    scene.add(connectionsMesh);

    palette.forEach((color, i) => {
        if (i < 3) {
            nMat.uniforms.uPulseColors.value[i].copy(color);
            cMat.uniforms.uPulseColors.value[i].copy(color);
        }
    });
}

createVisualization(currentFormation);

// Auto morph every 30s
setInterval(() => {
    currentFormation = (currentFormation + 1) % 3;
    createVisualization(currentFormation);
}, 30000);

// Click pulse
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const iPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const iPoint = new THREE.Vector3();
let lastPulseIdx = 0;

function triggerPulse(cx, cy) {
    pointer.x = (cx / window.innerWidth) * 2 - 1;
    pointer.y = -(cy / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    iPlane.normal.copy(camera.position).normalize();
    iPlane.constant = -iPlane.normal.dot(camera.position) + camera.position.length() * 0.5;
    if (raycaster.ray.intersectPlane(iPlane, iPoint) && nodesMesh && connectionsMesh) {
        const time = clock.getElapsedTime();
        lastPulseIdx = (lastPulseIdx + 1) % 3;
        [nodesMesh, connectionsMesh].forEach(mesh => {
            mesh.material.uniforms.uPulsePositions.value[lastPulseIdx].copy(iPoint);
            mesh.material.uniforms.uPulseTimes.value[lastPulseIdx] = time;
        });
        const palette = colorPalettes[activePaletteIndex];
        const rc = palette[Math.floor(Math.random() * palette.length)];
        nodesMesh.material.uniforms.uPulseColors.value[lastPulseIdx].copy(rc);
        connectionsMesh.material.uniforms.uPulseColors.value[lastPulseIdx].copy(rc);
    }
}

canvas.addEventListener('click', e => triggerPulse(e.clientX, e.clientY));
canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) triggerPulse(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// Animation loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    if (overlay && overlay.style.display === 'none') return;
    if (document.hidden) return;

    const time = clock.getElapsedTime();

    // 줌인 애니메이션
    if (zoomStartTime < 0) zoomStartTime = time;
    const zoomElapsed = time - zoomStartTime;
    if (zoomElapsed < zoomDuration) {
        const t = zoomElapsed / zoomDuration;
        const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
        camera.position.lerpVectors(new THREE.Vector3(0, 20, 80), cameraTarget, ease);
    }

    controls.update();
    starField.material.uniforms.uTime.value = time;
    if (nodesMesh) nodesMesh.material.uniforms.uTime.value = time;
    if (connectionsMesh) connectionsMesh.material.uniforms.uTime.value = time;
    composer.render();
}
animate();

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});
