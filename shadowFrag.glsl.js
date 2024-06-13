export default `#version 300 es
precision highp float;

uniform sampler2D uSampler;

in vec4 vColor;
in vec4 vLightSpacePos;
out vec4 outColor;

vec3 shadowCalculation(vec4 lightSpacePos) {
    vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
    projCoords = projCoords * 0.5 + 0.5; 
    return projCoords;
}

void main() {
    // TODO: compute shadowmap coordenates 
    // TODO: evaluate if point is in shadow or not
    vec3 projCoords = shadowCalculation(vLightSpacePos);
    float closestDepth = texture(uSampler, projCoords.xy).r;

    float currentDepth = projCoords.z;
    float bias = 0.0025;
    float shadow = currentDepth - bias > closestDepth ? 1.0 : 0.0;
    
    outColor = vec4((1.0 - shadow * 0.5) * vColor.rgb, 1);
}
`;