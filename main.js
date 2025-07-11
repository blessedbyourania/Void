import * as THREE from 'three';
import { GUI } from 'lil-gui';

// --- Global Variables ---
let camera, scene, renderer;
let material;
let is_transitioning = false;
let shader_index = 0;

const uniforms = {
    time: { value: 0.0 },
    resolution: { value: new THREE.Vector2() },
    transition_progress: { value: 0.0 },
    interstellar_mix: { value: 0.0 }
};

// --- Vertex Shader ---
const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// --- Shader Code ---
const tunnel_shader_code = `
    vec4 get_tunnel_color(vec2 u, float t) {
        vec4 fragColor = vec4(0.0);
        float d = 0.0;
        for (float i = 0.0; i < 100.0; i++) {
            vec3 p = vec3(u * d, d + t * 2.0);
            float angle = p.z * 0.2;
            p.xy *= mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
            float s = sin(p.y + p.x);
            for (float n = 1.0; n < 32.0; n += n) {
                s -= abs(dot(cos(0.3 * t + p * n), vec3(0.3))) / n;
            }
            s = 0.01 + abs(s) * 0.8;
            d += s;
            fragColor += vec4(0.1 / s);
        }
        return tanh(fragColor / 20000.0 / length(u));
    }
`;

const galaxy_shader_code = `
    // Galaxy shader by Frank Hugenroth, adapted for Three.js
    float hash( float n ) {
        return fract(cos(n)*41415.92653);
    }
    float noise( in vec2 x ) {
        vec2 p  = floor(x);
        vec2 f  = smoothstep(0.0, 1.0, fract(x));
        float n = p.x + p.y*57.0;
        return mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
            mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y);
    }
    float noise( in vec3 x ) {
        vec3 p  = floor(x);
        vec3 f  = smoothstep(0.0, 1.0, fract(x));
        float n = p.x + p.y*57.0 + 113.0*p.z;
        return mix(mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
            mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y),
            mix(mix( hash(n+113.0), hash(n+114.0),f.x),
            mix( hash(n+170.0), hash(n+171.0),f.x),f.y),f.z);
    }
    mat3 m = mat3( 0.00,  1.60,  1.20, -1.60,  0.72, -0.96, -1.20, -0.96,  1.28 );
    float fbmslow( vec3 p ) {
        float f = 0.5000*noise( p ); p = m*p*1.2;
        f += 0.2500*noise( p ); p = m*p*1.3;
        f += 0.1666*noise( p ); p = m*p*1.4;
        f += 0.0834*noise( p ); p = m*p*1.84;
        return f;
    }
    float fbm( vec3 p ) {
        float f = 0.0, a = 1.0, s=0.0;
        f += a*noise( p ); p = m*p*1.149; s += a; a *= .75;
        f += a*noise( p ); p = m*p*1.41; s += a; a *= .75;
        f += a*noise( p ); p = m*p*1.51; s += a; a *= .65;
        f += a*noise( p ); p = m*p*1.21; s += a; a *= .35;
        f += a*noise( p ); p = m*p*1.41; s += a; a *= .75;
        f += a*noise( p ); 
        return f/s;
    }
    vec4 get_galaxy_color(vec2 fragCoord, vec2 resolution, float time) {
        float t = time * 0.1;
        vec2 xy = -1.0 + 2.0*fragCoord.xy / resolution.xy;
        float fade = min(1.0, t*1.0)*min(1.0,max(0.0, 15.0-t));
        float fade2= max(0.0, t-10.0)*0.37;
        float glow = max(-0.25,1.0+pow(fade2, 10.0) - 0.001*pow(fade2, 25.0));
        vec3 campos = vec3(500.0, 850.0, -0.0-cos((t-1.4)/2.0)*2000.0);
        vec3 camtar = vec3(0.0, 0.0, 0.0);
        float roll = 0.34;
        vec3 cw = normalize(camtar-campos);
        vec3 cp = vec3(sin(roll), cos(roll),0.0);
        vec3 cu = normalize(cross(cw,cp));
        vec3 cv = normalize(cross(cu,cw));
        vec3 rd = normalize( xy.x*cu + xy.y*cv + 1.6*cw );
        vec3 light = normalize( vec3(  0.0, 0.0,  0.0 )-campos );
        float sundot = clamp(dot(light,rd),0.0,1.0);
        vec3 col = glow*1.2*min(vec3(1.0, 1.0, 1.0), vec3(2.0,1.0,0.5)*pow( sundot, 100.0 ));
        col += 0.3*vec3(0.8,0.9,1.2)*pow( sundot, 8.0 );
        vec3 stars = 85.5*vec3(pow(fbmslow(rd.xyz*312.0), 7.0))*vec3(pow(fbmslow(rd.zxy*440.3), 8.0));
        vec3 cpos = 1500.0*rd + vec3(831.0-t*30.0, 321.0, 1000.0);
        col += vec3(0.4, 0.5, 1.0) * ((fbmslow( cpos*0.0035 ) - 0.5));
        cpos += vec3(831.0-t*33.0, 321.0, 999.0);
        col += vec3(0.6, 0.3, 0.6) * 10.0*pow((fbmslow( cpos*0.0045 )), 10.0);
        cpos += vec3(3831.0-t*39.0, 221.0, 999.0);
        col += 0.03*vec3(0.6, 0.0, 0.0) * 10.0*pow((fbmslow( cpos*0.0145 )), 2.0);
        cpos = 1500.0*rd + vec3(831.0, 321.0, 999.0);
        col += stars*fbm(cpos*0.0021);
        vec2 shift = vec2( t*100.0, t*180.0 );
        vec4 sum = vec4(0,0,0,0); 
        float c = campos.y / rd.y; 
        vec3 cpos2 = campos - c*rd;
        float radius = length(cpos2.xz)/1000.0;
        if (radius<1.8) {
            for (int q=10; q>-10; q--) {
                if (sum.w>0.999) continue;
                float c = (float(q)*8.0-campos.y) / rd.y;
                vec3 cpos = campos + c*rd;
                float see = dot(normalize(cpos), normalize(campos));
                vec3 lightUnvis = vec3(0.0,0.0,0.0 );
                vec3 lightVis   = vec3(1.3,1.2,1.2 );
                vec3 shine = mix(lightVis, lightUnvis, smoothstep(0.0, 1.0, see));
                float radius = length(cpos.xz)/999.0;
                if (radius>1.0) continue;
                float rot = 3.00*(radius)-t;
                cpos.xz *= mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
                cpos += vec3(831.0+shift.x, 321.0+float(q)*mix(250.0, 50.0, radius)-shift.x*0.2, 1330.0+shift.y);
                cpos *= mix(0.0025, 0.0028, radius); 
                float alpha = smoothstep(0.50, 1.0, fbm( cpos ));
                alpha *= 1.3*pow(smoothstep(1.0, 0.0, radius), 0.3);
                vec3 dustcolor = mix(vec3( 2.0, 1.3, 1.0 ), vec3( 0.1,0.2,0.3 ), pow(radius, 0.5));
                vec3 localcolor = mix(dustcolor, shine, alpha);
                float gstar = 2.0*pow(noise( cpos*21.40 ), 22.0);
                float gstar2= 3.0*pow(noise( cpos*26.55 ), 34.0);
                float gholes= 1.0*pow(noise( cpos*11.55 ), 14.0);
                localcolor += vec3(1.0, 0.6, 0.3)*gstar;
                localcolor += vec3(1.0, 1.0, 0.7)*gstar2;
                localcolor -= gholes;
                alpha = (1.0-sum.w)*alpha;
                sum += vec4(localcolor*alpha, alpha);
            }
            for (int q=0; q<20; q++) {
                if (sum.w>0.999) continue;
                float c = (float(q)*4.0-campos.y) / rd.y;
                vec3 cpos = campos + c*rd;
                float see = dot(normalize(cpos), normalize(campos));
                vec3 lightUnvis = vec3(0.0,0.0,0.0 );
                vec3 lightVis   = vec3(1.3,1.2,1.2 );
                vec3 shine = mix(lightVis, lightUnvis, smoothstep(0.0, 1.0, see));
                float radius = length(cpos.xz)/200.0;
                if (radius>1.0) continue;
                float rot = 3.2*(radius)-t*1.1;
                cpos.xz *= mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
                cpos += vec3(831.0+shift.x, 321.0+float(q)*mix(250.0, 50.0, radius)-shift.x*0.2, 1330.0+shift.y);
                float alpha = 0.1+smoothstep(0.6, 1.0, fbm( cpos ));
                alpha *= 1.2*(pow(smoothstep(1.0, 0.0, radius), 0.72) - pow(smoothstep(1.0, 0.0, radius*1.875), 0.2));
                vec3 localcolor = vec3(0.0, 0.0, 0.0);
                alpha = (1.0-sum.w)*alpha;
                sum += vec4(localcolor*alpha, alpha);
            }
        }
        float alpha = smoothstep(1.0-radius*0.5, 1.0, sum.w);
        sum.rgb /= sum.w+0.0001;
        sum.rgb -= 0.2*vec3(0.8, 0.75, 0.7) * pow(sundot,10.0)*alpha;
        sum.rgb += min(glow, 10.0)*0.2*vec3(1.2, 1.2, 1.2) * pow(sundot,5.0)*(1.0-alpha);
        col = mix( col, sum.rgb , sum.w);
        col = fade*mix(col, vec3(0.3,0.5,0.9), 29.0*(pow( sundot, 50.0 )-pow( sundot, 60.0 ))/(2.0+9.0*abs(rd.y)));
        vec2 xy2 = fragCoord.xy / resolution.xy;
        col *= vec3(0.5, 0.5, 0.5) + 0.25*pow(100.0*xy2.x*xy2.y*(1.0-xy2.x)*(1.0-xy2.y), 0.5 );	
        return vec4(col,1.0);
    }
`;

const transition_shader_code = `
    // 'Warp Speed 2' by David Hoskins 2015.
    // Adapted for Three.js
    vec4 get_transition_color(vec2 fragCoord, vec2 resolution, float time) {
        float s = 0.0, v = 0.0;
        vec2 uv = (fragCoord / resolution) * 2.0 - 1.0;
        float t = (time - 2.0) * 58.0;
        vec3 col = vec3(0.0);
        vec3 init = vec3(sin(t * 0.0032) * 0.3, 0.35 - cos(t * 0.005) * 0.3, t * 0.002);
        for (int r = 0; r < 100; r++) 
        {
            vec3 p = init + s * vec3(uv, 0.05);
            p.z = fract(p.z);
            for (int i = 0; i < 10; i++) {
                p = abs(p * 2.04) / dot(p, p) - 0.9;
            }
            v += pow(dot(p, p), 0.7) * 0.06;
            col += vec3(v) * 0.00003;
            s += 0.025;
        }
        return tanh(vec4(col, 1.0) / 30.0 / length(uv));
    }
`;


// --- Main Application Logic ---
function main() {
    // --- Shader Compilation ---
    const fragmentShader = `
        uniform vec2 resolution;
        uniform float time;
        uniform float transition_progress;
        uniform float interstellar_mix;
        varying vec2 vUv;

        ${tunnel_shader_code}
        ${galaxy_shader_code}
        ${transition_shader_code}

        // --- Main Shader Logic ---
        void main() {
            vec2 res_coord = gl_FragCoord.xy;
            vec2 u = (res_coord - 0.5 * resolution.xy) / resolution.y;
            vec4 tunnel_color = get_tunnel_color(u, time);
            vec4 galaxy_color = get_galaxy_color(res_coord, resolution.xy, time);
            vec4 transition_effect = get_transition_color(res_coord, resolution.xy, time);
            vec4 main_mix = mix(tunnel_color, galaxy_color, smoothstep(0.0, 1.0, transition_progress));
            vec4 final_color = mix(main_mix, transition_effect, smoothstep(0.0, 1.0, interstellar_mix));
            gl_FragColor = vec4(final_color.rgb, 1.0);
        }
    `;

    // --- Initialization ---
    init(fragmentShader);
    
    // --- Start Animation Loop ---
    animate(0);
}

function init(fragmentShader) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    uniforms.resolution.value.x = window.innerWidth;
    uniforms.resolution.value.y = window.innerHeight;

    material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    // --- GUI Setup ---
    const gui = new GUI();
    const transition_controls = {
        transform: () => {
            if (is_transitioning) return;
            is_transitioning = true;
            
            const transition_duration = 1500;
            const interstellar_hold = 2000;

            const animate_phase = (uniform, target, duration, onComplete) => {
                const start_value = uniform.value;
                const start_time = performance.now();
                function do_animate() {
                    const elapsed = performance.now() - start_time;
                    const progress = Math.min(elapsed / duration, 1.0);
                    uniform.value = THREE.MathUtils.lerp(start_value, target, progress);
                    if (progress < 1.0) requestAnimationFrame(do_animate);
                    else if (onComplete) onComplete();
                }
                do_animate();
            };

            if (shader_index === 0) { // Tunnel -> Galaxy
                animate_phase(uniforms.interstellar_mix, 1.0, transition_duration, () => {
                    animate_phase(uniforms.transition_progress, 1.0, transition_duration, () => {
                        setTimeout(() => {
                            animate_phase(uniforms.interstellar_mix, 0.0, transition_duration, () => {
                                shader_index = 1;
                                is_transitioning = false;
                            });
                        }, interstellar_hold / 2);
                    });
                });
            } else { // Galaxy -> Tunnel
                animate_phase(uniforms.interstellar_mix, 1.0, transition_duration, () => {
                    animate_phase(uniforms.transition_progress, 0.0, transition_duration, () => {
                        setTimeout(() => {
                             animate_phase(uniforms.interstellar_mix, 0.0, transition_duration, () => {
                                shader_index = 0;
                                is_transitioning = false;
                            });
                        }, interstellar_hold / 2);
                    });
                });
            }
        }
    };
    gui.add(transition_controls, 'transform').name('Enter The Void and Fall With Me');

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.resolution.value.x = window.innerWidth;
    uniforms.resolution.value.y = window.innerHeight;
}

function animate(timestamp) {
    requestAnimationFrame(animate);
    uniforms.time.value = timestamp / 1000.0;
    renderer.render(scene, camera);
}

main(); 