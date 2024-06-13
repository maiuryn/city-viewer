import layerVertShaderSrc from './layerVert.glsl.js';
import layerFragShaderSrc from './layerFrag.glsl.js';
import shadowFragShaderSrc from './shadowFrag.glsl.js';
import shadowVertShaderSrc from './shadowVert.glsl.js';
import depthFragShaderSrc from './depthFrag.glsl.js';
import depthVertShaderSrc from './depthVert.glsl.js';

var gl;

var layers = null
var renderToScreen = null;
var fbo = null;
var currRotate = 0;
var currLightRotate = 0;
var currLightDirection = null;
var currZoom = 0;
var currProj = 'perspective';
var currResolution = 2048;
var displayShadowmap = false;
var dragging = false;

/*
    Rotate and Zoom
*/
window.mousemove = function (event) {
    var deltax, deltay;

    // console.log(event.clientX, event.clientY, event.which);
    if (dragging) {
        deltax = event.clientX - dragging.clientX;
        deltay = -(event.clientY - dragging.clientY);
        // console.log("moved: " + deltax + " " + deltay);

        document.querySelector("#rotate").value -= deltax;
        window.updateRotate();
        
        document.querySelector("#zoom").value -= deltay;
        window.updateZoom();

        dragging = event;
        event.preventDefault();
    }
};

self.mousedown = function (event) {
    // console.log(event.clientX, event.clientY);
    dragging = event;
    event.preventDefault();
};

self.mouseup = function(event) {
    dragging = null;
}

/*
    FBO
*/
class FBO {
    constructor(size) {
        // TODO: Create FBO and texture with size
        this.size = size;
        this.texture = createTexture2D(gl, this.size, this.size, gl.DEPTH_COMPONENT32F, 0,
                                       gl.DEPTH_COMPONENT, gl.FLOAT, null, gl.NEAREST, gl.NEAREST,
                                       gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
        this.fbo = createFBO(gl, gl.DEPTH_ATTACHMENT, this.texture);
    }

    start() {
        // TODO: Bind FBO, set viewport to size, clear depth buffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.size, this.size);
        gl.clear(gl.DEPTH_BUFFER_BIT);
    }

    stop() {
        // TODO: unbind FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}

/*
    Shadow map
*/
class ShadowMapProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, shadowVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, shadowFragShaderSrc);
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);

        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.colorAttribLoc = gl.getUniformLocation(this.program, "uColor");
        this.modelLoc = gl.getUniformLocation(this.program, "uModel");
        this.projectionLoc = gl.getUniformLocation(this.program, "uProjection");
        this.viewLoc = gl.getUniformLocation(this.program, "uView");
        this.lightViewLoc = gl.getUniformLocation(this.program, "uLightView");
        this.lightProjectionLoc = gl.getUniformLocation(this.program, "uLightProjection");
        this.samplerLoc = gl.getUniformLocation(this.program, "uSampler");
        this.hasNormalsAttribLoc = gl.getUniformLocation(this.program, "uHasNormals");
        this.lightDirAttribLoc = gl.getUniformLocation(this.program, "uLightDir");    
    }

    use() {
        // TODO: use program
        gl.useProgram(this.program);
    }
}

/*
    Render to screen program
*/
class RenderToScreenProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, depthVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, depthFragShaderSrc);
        
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);
        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.samplerLoc = gl.getUniformLocation(this.program, "uSampler");

        // TODO: Create quad VBO and VAO
        // The vertices for two triangles that make a square flat on the z axis
        var vertices = [-1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0]; 
        this.vertexBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(vertices));
        this.vao = createVAO(gl, this.posAttribLoc, this.vertexBuffer);
    }

    draw(texture) {
        // TODO: Render quad and display texture
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.useProgram(this.program);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.uniform1i(this.samplerLoc, 0);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

}

/*
    Layer program
*/
class LayerProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, layerVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, layerFragShaderSrc);
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);

        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.colorAttribLoc = gl.getUniformLocation(this.program, "uColor");
        this.modelLoc = gl.getUniformLocation(this.program, "uModel");
        this.projectionLoc = gl.getUniformLocation(this.program, "uProjection");
        this.viewLoc = gl.getUniformLocation(this.program, "uView");
    }

    use() {
        gl.useProgram(this.program);
    }
}


/*
    Collection of layers
*/
class Layers {
    constructor() {
        this.layers = {};
        this.centroid = [0,0,0];
    }

    addLayer(name, vertices, indices, color, normals) {
        if(normals == undefined)
            normals = null;
        var layer = new Layer(vertices, indices, color, normals);
        layer.init();
        this.layers[name] = layer;
        this.centroid = this.getCentroid();
    }

    removeLayer(name) {
        delete this.layers[name];
    }

    draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix = null, lightProjectionMatrix = null, shadowPass = false, texture = null) {
        for(var layer in this.layers) {
            if(layer == 'surface') {
                gl.polygonOffset(1, 1);
            }
            else {
                gl.polygonOffset(0, 0);
            }
            this.layers[layer].draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, shadowPass, texture);
        }
    }

    
    getCentroid() {
        var sum = [0,0,0];
        var numpts = 0;
        for(var layer in this.layers) {
            numpts += this.layers[layer].vertices.length/3;
            for(var i=0; i<this.layers[layer].vertices.length; i+=3) {
                var x = this.layers[layer].vertices[i];
                var y = this.layers[layer].vertices[i+1];
                var z = this.layers[layer].vertices[i+2];
    
                sum[0]+=x;
                sum[1]+=y;
                sum[2]+=z;
            }
        }
        return [sum[0]/numpts,sum[1]/numpts,sum[2]/numpts];
    }
}

/*
    Layers without normals (water, parks, surface)
*/
class Layer {
    constructor(vertices, indices, color, normals = null) {
        this.vertices = vertices;
        this.indices = indices;
        this.color = color;
        this.normals = normals;

        this.hasNormals = false;
        if(this.normals) {
            this.hasNormals = true;
        }
    }

    init() {
        this.layerProgram = new LayerProgram();
        this.shadowProgram = new ShadowMapProgram();

        this.vertexBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.vertices));
        this.indexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.indices));

        if(this.normals) {
            this.normalBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.normals));
            this.vao = createVAO(gl, 0, this.vertexBuffer, 1, this.normalBuffer);
        }
        else {
            this.vao = createVAO(gl, 0, this.vertexBuffer);
        }
    }

    draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, shadowPass = false, texture = null) {
        // TODO: Handle shadow pass (using ShadowMapProgram) and regular pass (using LayerProgram)
        if (shadowPass) {
            var program = this.shadowProgram;
            program.use();

            gl.uniformMatrix4fv(program.modelLoc, false, new Float32Array(modelMatrix));
            gl.uniformMatrix4fv(program.viewLoc, false, new Float32Array(viewMatrix));
            gl.uniformMatrix4fv(program.projectionLoc, false, new Float32Array(projectionMatrix));
            gl.uniformMatrix4fv(program.lightViewLoc, false, new Float32Array(lightViewMatrix));
            gl.uniformMatrix4fv(program.lightProjectionLoc, false, new Float32Array(lightProjectionMatrix));
            
            gl.uniform4fv(program.colorAttribLoc, this.color);
            gl.uniform3fv(program.lightDirAttribLoc, currLightDirection);
            gl.uniform1i(program.hasNormalsAttribLoc, this.hasNormals);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(program.samplerLoc, 0);
        }
        else {
            var program = this.layerProgram;
            program.use();

            gl.uniformMatrix4fv(program.modelLoc, false, new Float32Array(modelMatrix));
            gl.uniformMatrix4fv(program.viewLoc, false, new Float32Array(viewMatrix));
            gl.uniformMatrix4fv(program.projectionLoc, false, new Float32Array(projectionMatrix));
            
            gl.uniform4fv(program.colorAttribLoc, this.color);
        }

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
    
    }
}

/*
    Event handlers
*/
window.updateRotate = function() {
    currRotate = parseInt(document.querySelector("#rotate").value);
}

window.updateLightRotate = function() {
    currLightRotate = parseInt(document.querySelector("#lightRotate").value);
}

window.updateZoom = function() {
    currZoom = parseFloat(document.querySelector("#zoom").value);
}

window.updateProjection = function() {
    currProj = document.querySelector("#projection").value;
}

window.displayShadowmap = function(e) {
    displayShadowmap = e.checked;
}

/*
    File handler
*/
window.handleFile = function(e) {
    var reader = new FileReader();
    reader.onload = function(evt) {
        var parsed = JSON.parse(evt.target.result);
        for(var layer in parsed){
            var aux = parsed[layer];
            layers.addLayer(layer, aux['coordinates'], aux['indices'], aux['color'], aux['normals']);
        }
    }
    reader.readAsText(e.files[0]);
}

/*
    Update transformation matrices
*/
function updateModelMatrix(centroid) {
    var modelMatrix = null;

    var translation1 = translateMatrix(-centroid[0], -centroid[1], -centroid[2]);
    var translation2 = translateMatrix(centroid[0], centroid[1], centroid[2]);

    var rotate = rotateZMatrix(currRotate * Math.PI / 180.0);
    modelMatrix = multiplyArrayOfMatrices([
        translation2,
        rotate,
        translation1
    ]);

    return modelMatrix;
}

function updateProjectionMatrix() {
    // TODO: Projection matrix
    var projectionMatrix = null;

    var aspect = window.innerWidth /  window.innerHeight;
    if(currProj == 'perspective') {
        projectionMatrix = perspectiveMatrix(45 * Math.PI / 180.0, aspect, 1, 100000);
    }
    else {
        var maxzoom = 5000;
        var size = maxzoom-(currZoom/100.0)*maxzoom*0.99;
        projectionMatrix = orthographicMatrix(-aspect*size, aspect*size, -1*size, 1*size, -1, 100000);
    }

    return projectionMatrix;
}

function updateViewMatrix(centroid){
    // TODO: View matrix
    var viewMatrix = null;

    var maxzoom = 5000;
    var zoom = maxzoom - (currZoom/100.0)*maxzoom*0.99;
    var lookat = lookAt(add(centroid, [zoom,zoom,zoom]), centroid, [0,0,1]);
    viewMatrix = lookat;

    return viewMatrix;
}

function updateLightViewMatrix(centroid) {
    // TODO: Light view matrix
    var angleRadians = currLightRotate * Math.PI / 180.0;
    var radius = 500;
    var x = radius * Math.cos(angleRadians);
    var y = radius * Math.sin(angleRadians);
    var pos = add(centroid, [x, y, radius]);
    var lightViewMatrix = lookAt(pos, centroid, [0, 0, 1]);
    currLightDirection = normalize(sub(pos, centroid));
    return lightViewMatrix;
}

function updateLightProjectionMatrix() {
    // TODO: Light projection matrix
    var size = 8192;
    var lightProjectionMatrix = orthographicMatrix(-size, size, -size, size, -2500, 10000);
    return lightProjectionMatrix;
}

/*
    Main draw function (should call layers.draw)
*/
function draw() {

    gl.clearColor(190/255, 210/255, 215/255, 1);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // TODO: First rendering pass, rendering using FBO
    fbo.start();
    var modelMatrix = updateModelMatrix(layers.centroid);
    var lightViewMatrix = updateLightViewMatrix(layers.centroid);
    var lightProjectionMatrix = updateLightProjectionMatrix(layers.centroid);
    layers.draw(modelMatrix, lightViewMatrix, lightProjectionMatrix);
    fbo.stop();
    

    if(!displayShadowmap) {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        // TODO: Second rendering pass, render to screen
        var viewMatrix = updateViewMatrix(layers.centroid);
        var projectionMatrix = updateProjectionMatrix();
        layers.draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, true, fbo.texture);
    }
    else {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        // TODO: Render shadowmap texture computed in first pass
        renderToScreen.draw(fbo.texture);
    }

    requestAnimationFrame(draw);

}

/*
    Initialize everything
*/
function initialize() {

    var canvas = document.querySelector("#glcanvas");
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    gl = canvas.getContext("webgl2");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.enable(gl.POLYGON_OFFSET_FILL);

    layers = new Layers();
    fbo = new FBO(currResolution);
    renderToScreen = new RenderToScreenProgram();

    window.requestAnimationFrame(draw);

}


window.onload = initialize;