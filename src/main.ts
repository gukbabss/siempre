// src/main.ts
import { mat4 } from 'gl-matrix';
import { cardVertices, cardIndices, cardShader } from './cube';

async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  // 배경 이미지 초기화 (기본 고급스러운 배경)
  canvas.style.cssText = "background: url('https://assets.st-note.com/img/1709077873744-slRw3kW1qf.png?width=2000&height=2000&fit=bounds&quality=85') center/cover; width:100vw; height:100vh;";

const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  // 세련된 UI
  const ui = document.createElement('div');
  ui.style.cssText = "position:absolute;top:30px;left:30px;background:rgba(12,12,12,0.92);padding:24px;border-radius:16px;color:#d4af37;font-family:sans-serif;border:1px solid #3d342c;backdrop-filter:blur(15px);z-index:100;box-shadow: 0 20px 50px rgba(0,0,0,0.5)";
  ui.innerHTML = `
    <h3 style="margin:0 0 15px;letter-spacing:1px;font-weight:300">JELLY PRO COMPLETE</h3>
    <button id="bgBtn" style="width:100%;padding:8px;margin-bottom:10px;background:#222;border:1px solid #444;color:#aaa;cursor:pointer">Change Background</button>
    <button id="cdBtn" style="width:100%;padding:8px;margin-bottom:20px;background:#222;border:1px solid #444;color:#aaa;cursor:pointer">Change Card Tex</button>
    <div style="font-size:11px;margin-bottom:8px">FLUIDITY: <span id="jv">0.50</span></div>
    <input type="range" id="j" min="0" max="1" step="0.01" value="0.5" style="width:100%;accent-color:#d4af37">
    <div style="margin-top:15px;font-size:10px;color:#666">R-CLICK TO FLIP | DRAG TO ROTATE</div>
    <input type="file" id="bgFile" style="display:none">
    <input type="file" id="cdFile" style="display:none">
  `;
  document.body.appendChild(ui);

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let cardTex = device.createTexture({ size: [1,1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  let hasTex = 0, jelly = 0.5, targetFlip = 0, currentFlip = 0;

  // 이벤트 연결
  document.getElementById('bgBtn')!.onclick = () => (document.getElementById('bgFile') as HTMLInputElement).click();
  document.getElementById('cdBtn')!.onclick = () => (document.getElementById('cdFile') as HTMLInputElement).click();
  
  document.getElementById('bgFile')!.onchange = (e: any) => {
    canvas.style.backgroundImage = `url(${URL.createObjectURL(e.target.files[0])})`;
  };
  document.getElementById('cdFile')!.onchange = async (e: any) => {
    const b = await createImageBitmap(e.target.files[0]);
    cardTex = device.createTexture({ size: [b.width, b.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: b }, { texture: cardTex }, [b.width, b.height]);
    hasTex = 1.0; updateBG();
  };
  document.getElementById('j')!.oninput = (e: any) => {
    jelly = parseFloat((e.target as HTMLInputElement).value);
    document.getElementById('jv')!.innerText = jelly.toFixed(2);
  };
  canvas.oncontextmenu = (e) => { e.preventDefault(); targetFlip = targetFlip === 0 ? Math.PI : 0; };

  const vBuf = device.createBuffer({ size: cardVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vBuf, 0, cardVertices);
  const iBuf = device.createBuffer({ size: cardIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(iBuf, 0, cardIndices);
  const uBuf = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: device.createShaderModule({ code: cardShader }), entryPoint: 'vs_main', buffers: [{
      arrayStride: 32, attributes: [{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'}]
    }]},
    fragment: { module: device.createShaderModule({ code: cardShader }), entryPoint: 'fs_main', targets: [{ format, blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
    }}]},
    primitive: { topology: 'triangle-list' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
  });

  let bindGroup: GPUBindGroup;
  const updateBG = () => {
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: sampler }, { binding: 2, resource: cardTex.createView() }]
    });
  };
  updateBG();

  let rx = 0, ry = 0, drag = false, lx = 0, ly = 0, vel = 0, lastRY = 0;
  canvas.onmousedown = (e) => { if(e.button === 0) drag = true; lx = e.clientX; ly = e.clientY; };
  window.onmouseup = () => drag = false;
  window.onmousemove = (e) => { if(drag) { ry += (e.clientX-lx)*0.01; rx += (e.clientY-ly)*0.01; lx=e.clientX; ly=e.clientY; }};

  function frame() {
    currentFlip += (targetFlip - currentFlip) * 0.1;
    const totalRY = ry + currentFlip;
    const dry = totalRY - lastRY;
    vel += (dry * 5.5 - vel) * 0.18; // 물리 가속도
    lastRY = totalRY;
    vel *= 0.93; // 댐핑

    const p = mat4.create(); mat4.perspective(p, Math.PI/4, canvas.width/canvas.height, 0.1, 100);
    const v = mat4.create(); mat4.lookAt(v, [0,0,5], [0,0,0], [0,1,0]);
    const m = mat4.create();
    mat4.rotateX(m, m, rx); mat4.rotateY(m, m, totalRY); mat4.scale(m, m, [2, 2.8, 1]);
    const mvp = mat4.create(); mat4.multiply(mvp, p, v); mat4.multiply(mvp, mvp, m);

    device.queue.writeBuffer(uBuf, 0, (mvp as Float32Array).buffer);
    device.queue.writeBuffer(uBuf, 64, (m as Float32Array).buffer);
    device.queue.writeBuffer(uBuf, 128, new Float32Array([10, 10, 15, jelly, 0, 0, 5, vel, performance.now()/1000, hasTex]));

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: {r:0, g:0, b:0, a:0}, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: device.createTexture({size:[canvas.width, canvas.height], format:'depth24plus', usage:GPUTextureUsage.RENDER_ATTACHMENT}).createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }
    });
    pass.setPipeline(pipeline); pass.setIndexBuffer(iBuf, 'uint32'); pass.setVertexBuffer(0, vBuf);
    pass.setBindGroup(0, bindGroup); pass.drawIndexed(cardIndices.length);
    pass.end();
    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }
  frame();
}
init();