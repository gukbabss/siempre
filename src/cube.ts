// src/cube.ts
export const divisions = 64; 
const thickness = 0.1; // 카드의 두께감, 물리적 존재감을 더함

const vertices: number[] = [];
// 각 정점은 위치(vec3), 노멀(vec3), UV(vec2)로 구성
// (ux - 0.5, uy - 0.5)를 통해 중심을 (0,0)으로 맞춤
for (let y = 0; y <= divisions; y++) {
  for (let x = 0; x <= divisions; x++) {
    const ux = x / divisions;
    const uy = y / divisions;
    // Front Face (Z+)
    // 노멀은 Z축 양의 방향 (0, 0, 1)
    vertices.push(ux - 0.5, uy - 0.5, thickness / 2, 0, 0, 1, ux, 1 - uy);
    // Back Face (Z-)
    // 노멀은 Z축 음의 방향 (0, 0, -1)
    // UV의 U좌표를 반전시켜 뒷면 텍스처가 거울상이 되지 않도록 함
    vertices.push(ux - 0.5, uy - 0.5, -thickness / 2, 0, 0, -1, 1.0 - ux, 1 - uy);
  }
}

const indices: number[] = [];
// 각 행마다 (divisions + 1)개의 정점 쌍 (앞면+뒷면)이 있으므로 2를 곱함
const stride = (divisions + 1) * 2; 

for (let y = 0; y < divisions; y++) {
  for (let x = 0; x < divisions; x++) {
    const i = y * stride + x * 2; // 현재 정점 쌍의 시작 인덱스
    // 앞면 두 개의 삼각형 (쿼드 구성)
    indices.push(i, i + 2, i + stride);         // 첫 번째 삼각형
    indices.push(i + 2, i + stride + 2, i + stride); // 두 번째 삼각형
    // 뒷면 두 개의 삼각형 (쿼드 구성, 와인딩 순서 반대)
    indices.push(i + 1, i + stride + 1, i + 3);       // 첫 번째 삼각형
    indices.push(i + 3, i + stride + 1, i + stride + 3); // 두 번째 삼각형
  }
}

// 카드의 옆면을 렌더링하여 완전한 3D 솔리드 메쉬를 만듦
// 모든 가장자리를 따라 앞면과 뒷면 정점을 연결하는 삼각형 생성
for (let i = 0; i < divisions; i++) {
  // 상단 가장자리 (Top Edge)
  const top_i = i * 2; // 현재 정점 쌍의 인덱스 (y=0)
  indices.push(top_i, top_i + 1, top_i + 2); 
  indices.push(top_i + 1, top_i + 3, top_i + 2);

  // 하단 가장자리 (Bottom Edge)
  const bottom_i = (divisions * stride) + i * 2; // 현재 정점 쌍의 인덱스 (y=divisions)
  indices.push(bottom_i, bottom_i + 2, bottom_i + 1); 
  indices.push(bottom_i + 1, bottom_i + 2, bottom_i + 3);

  // 좌측 가장자리 (Left Edge)
  const left_i = i * stride; // 현재 정점 쌍의 인덱스 (x=0)
  indices.push(left_i, left_i + stride, left_i + 1);
  indices.push(left_i + 1, left_i + stride, left_i + stride + 1);
  
  // 우측 가장자리 (Right Edge)
  const right_i = (i * stride) + (divisions * 2); // 현재 정점 쌍의 인덱스 (x=divisions)
  indices.push(right_i, right_i + 1, right_i + stride);
  indices.push(right_i + 1, right_i + stride + 1, right_i + stride);
}

export const cardVertices = new Float32Array(vertices);
export const cardIndices = new Uint32Array(indices);

// 버텍스 레이아웃 정의 (GPU에 데이터 구조를 알려줌)
export const vertexLayout: GPUVertexBufferLayout = {
  arrayStride: 32, // 각 정점 데이터의 바이트 크기 (3 floats + 3 floats + 2 floats = 8 floats * 4 bytes/float = 32 bytes)
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, // 위치 (x,y,z)
    { shaderLocation: 1, offset: 12, format: 'float32x3' }, // 노멀 (nx,ny,nz)
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, // UV (u,v)
  ],
};

export const cardShader = `
  // 쉐이더 유니폼 버퍼 구조체 정의
  struct Uniforms {
    mvp: mat4x4f,      // Model-View-Projection 행렬
    model: mat4x4f,    // Model 행렬 (월드 공간 위치)
    lightPos: vec3f,   // 광원 위치
    jelly: f32,        // 젤리 탄성 강도 (0.0 ~ 1.0)
    camPos: vec3f,     // 카메라 위치
    velocity: f32,     // 젤리 움직임 속도 (물리 엔진에서 전달)
    time: f32,         // 애니메이션 시간
    hasTex: f32,       // 텍스처 유무 플래그
  };
  @group(0) @binding(0) var<uniform> uni : Uniforms; // 유니폼 바인딩
  @group(0) @binding(1) var s: sampler;             // 텍스처 샘플러
  @group(0) @binding(2) var tCard: texture_2d<f32>; // 카드 텍스처

  // 버텍스 쉐이더 출력 및 프래그먼트 쉐이더 입력 구조체
  struct Out {
    @builtin(position) pos : vec4f,     // 클립 공간 정점 위치
    @location(0) norm : vec3f,          // 월드 공간 노멀
    @location(1) uv : vec2f,            // 텍스처 좌표
    @location(2) wPos : vec3f,          // 월드 공간 정점 위치
  };

  @vertex
  fn vs_main(@location(0) pos: vec3f, @location(1) norm: vec3f, @location(2) uv: vec2f) -> Out {
    var o: Out;
    var p = pos; // 정점 위치 복사 (수정 가능하게)
    
    // TypeGPU 스타일의 물리 기반 유체 탄성 로직 구현 (젤리의 핵심)
    let dist = length(pos.xy); // 정점에서 카드 중심까지의 거리
    // sin 파동 + velocity (속도) + dist (거리) + jelly (강도)를 결합
    let spring = sin(uni.time * 7.5 - dist * 9.0) * uni.velocity * (dist * uni.jelly * 2.5);
    p.z += spring; // Z축으로 파동 효과 적용 (카드가 출렁이게 함)

    o.pos = uni.mvp * vec4f(p, 1.0); // 최종 클립 공간 위치
    o.wPos = (uni.model * vec4f(p, 1.0)).xyz; // 월드 공간 위치
    o.norm = (uni.model * vec4f(norm, 0.0)).xyz; // 월드 공간 노멀
    o.uv = uv; // 텍스처 UV
    return o;
  }

  @fragment
  fn fs_main(in: Out) -> @location(0) vec4f {
    let N = normalize(in.norm);          // 정규화된 노멀
    let V = normalize(uni.camPos - in.wPos); // 정규화된 뷰(카메라) 벡터
    let L = normalize(uni.lightPos - in.wPos); // 정규화된 광원 벡터
    let H = normalize(L + V);            // 정규화된 하프 벡터 (Blinn-Phong용)

    // Fresnel Effect (프레넬 효과): 유리와 같은 유전체 표면에서
    // 시야각에 따라 반사광의 강도가 달라지는 현상
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    
    // 기본 카드 색상 (텍스처가 없을 경우) 또는 텍스처 샘플링
    var color = vec4f(0.08, 0.08, 0.09, 1.0); // 어두운 푸른 회색 계열
    if (uni.hasTex > 0.5) { 
        color = textureSample(tCard, s, in.uv); 
    }

    // Specular (스펙큘러): 고광택 반사
    // pow(max(dot(N, H), 0.0), 128.0) - Blinn-Phong 모델, 128.0은 shininess (매우 높은 광택)
    let spec = pow(max(dot(N, H), 0.0), 128.0) * (2.5 + uni.jelly * 12.0);
    // Rim Light (림 라이트): 가장자리에 나타나는 빛 (프레넬과 젤리 강도에 비례)
    let rim = fresnel * (uni.jelly + 0.45);
    
    // Diffuse (확산광): 광원 방향에 따른 표면의 밝기
    let diffuse = max(dot(N, L), 0.0) * 1.5; // 강도 1.5배

    // 최종 RGB 색상 합성
    // (카드 색상 * 확산광) + 스펙큘러 + 림 라이트 (청색 계열)
    let finalRGB = (color.rgb * diffuse) + vec3f(spec) + vec3f(0.3, 0.7, 1.0) * rim;
    
    // 알파 (투명도): 젤리 강도에 따라 투명도가 달라짐
    let alpha = mix(1.0, 0.65, uni.jelly); // jelly가 0일 때 1.0(불투명), 1일 때 0.65(투명)

    return vec4f(finalRGB, alpha);
  }
`;