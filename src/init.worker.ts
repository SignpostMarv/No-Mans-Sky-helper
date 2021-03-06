import {
	WebGLRenderer,
	PerspectiveCamera,
	Scene,
	DirectionalLight,
	SphereGeometry,
	MeshPhongMaterial,
	Mesh,
	Object3D,
	TorusGeometry,
	PointLight,
	Camera,
	Vector3,
	Color,
	BufferGeometry,
	PointsMaterial,
	Float32BufferAttribute,
	DataTexture,
	RGBAFormat,
} from 'three';

import {
	points,
} from './points.js';

import {
	marker,
	satellite,
} from './defs';

const scene = new Scene();
const light = new PointLight(0xffffff, 1);
const lightOpposite = new DirectionalLight(0xffffff, 0.1);
const planetRadius = 6_371_000 / 48; // ref https://www.reddit.com/r/NoMansSkyTheGame/comments/9lbcpx/the_size_of_planets_in_nms_more_details_in/e76k6z4/
const planet = new Mesh(
	new SphereGeometry(
		planetRadius,
		180,
		360
	),
	new MeshPhongMaterial({
		color: 0xff0000,
		flatShading: true,
	})
);
const rings = new Mesh(
	new TorusGeometry(planetRadius * 1.375, planetRadius * 0.125, 2, 360),
	new MeshPhongMaterial({
		color: 0xffffff,
		flatShading: true,
	})
);

const camera = new PerspectiveCamera(
	75,
	2,
	0.001,
	planetRadius * 4
);

const speed = {
	camera: 0.0001,
	light: -0.00001,
	satellite: -0.001,
};

const markers: marker[] = [];
const markerIds: number[] = [];
const markerPositions: WeakMap<marker, Vector3> = new WeakMap();
const markerColors: WeakMap<marker, Color> = new WeakMap();

const satellites: satellite[] = [];
const satelliteIds: number[] = [];
const satelliteMeshes: WeakMap<satellite, Object3D> = new WeakMap();

let renderer: WebGLRenderer|undefined;
let canvas: OffscreenCanvas|undefined;
let width = 640, height = 480;
let cancelRender = 0;
let now = performance.now();
let cameraAuto = true;
let cameraLat = 0, cameraLng = 0;
let cameraDistance = planetRadius;

function rotateThingAroundPlanet(
	thing: Object3D,
	speed: number,
	diff: number
): void {
	const {
		x,
		z,
	} = thing.position;

	const thingSpeed = speed * diff;
	const cos = Math.cos(thingSpeed);
	const sin = Math.sin(thingSpeed);

	thing.position.x = x * cos + z * sin;
	thing.position.z = z * cos - x * sin;

	thing.lookAt(planet.position);
}

function movePositionInThreeDimensions(
	position: Vector3,
	lat: number,
	lng: number,
	distanceAboveSurface: number
): void {
	const pi = Math.PI / 180;
	const phi = (90 - lat) * pi;
	const theta = (180 + lng) * pi;

	const distance = (
		planetRadius +
		distanceAboveSurface
	);

	position.x = distance * Math.sin(phi) * Math.cos(theta);
	position.y = distance * Math.sin(phi) * Math.sin(theta);
	position.z = distance * Math.cos(phi);
}

function placeThingInThreeDimensions(
	object: Object3D,
	lat: number,
	lng: number,
	distance: number
): void {
	movePositionInThreeDimensions(object.position, lat, lng, distance);
}

function placeMarkerInThreeDimensions(marker: marker): void
{
	const position = markerPositions.get(marker);

	if ( ! position) {
		throw new Error('marker does not have a position!');
	}

	movePositionInThreeDimensions(position, marker[1], marker[2], 0.02);
}

function placeCameraInThreeDimensions(
	camera: Camera,
	lat: number,
	lng: number,
	distance = cameraDistance
): void {
	placeThingInThreeDimensions(camera, lat, lng, distance);

	camera.lookAt(planet.position);
}

function render(): void {
	const diff = performance.now() - now;

	if (renderer) {
		if (cameraAuto) {
			rotateThingAroundPlanet(camera, speed.camera, diff);
		}
		rotateThingAroundPlanet(light, speed.light, diff);
		rotateThingAroundPlanet(lightOpposite, speed.light, diff);

		satellites.forEach(satellite => {
			rotateThingAroundPlanet(
				satelliteMeshes.get(satellite) as Object3D,
				speed.satellite,
				diff
			);
		});

		renderer.render(scene, camera);
	}

	cancelRender = requestAnimationFrame(render);
	now += diff;
}

function addMarker(marker: marker): void
{
	markerIds[markers.push(marker) - 1] = marker[0];

	const position = new Vector3();

	markerPositions.set(marker, position);
	markerColors.set(marker, new Color(0xffffff));

	placeMarkerInThreeDimensions(marker);
}

function rebuildPointsData(): void {
	Object.values(points).forEach(e => {
		e[2] = [];
	});

	markers.filter(e => undefined !== e).forEach(marker => {
		(
			Object.values(points).find(
				e => e[3].includes(marker[4].toLowerCase())
			) || points.markers
		)[2].push(marker);
	});

	Object.values(points).forEach(e => {
		const [, markerPoints, markerMarkers] = e;
		const geometry = markerPoints.geometry as BufferGeometry;

		const positions = new Float32Array(markerMarkers.length * 3);
		const colors = new Float32Array(markerMarkers.length * 3);

		markerMarkers.forEach((marker, i) => {
			const position = markerPositions.get(marker);
			const color = markerColors.get(marker);
			const offset = i * 3;

			if ( ! position) {
				throw new Error('cannot rebuild points, marker has no position!');
			} else if ( ! color) {
				throw new Error('cannot rebuild points, marker has no color!');
			}

			positions[offset + 0] = position.x;
			positions[offset + 1] = position.y;
			positions[offset + 2] = position.z;

			colors[offset + 0] = color.r;
			colors[offset + 1] = color.g;
			colors[offset + 2] = color.b;
		});

		geometry.setAttribute(
			'position',
			new Float32BufferAttribute(positions, 3)
		);
		geometry.setAttribute(
			'color',
			new Float32BufferAttribute(colors, 3)
		);

		geometry.computeBoundingSphere();

		if (markerMarkers.length < 1) {
			scene.remove(markerPoints);
		} else {
			scene.add(markerPoints);
		}
	});
}

function addSatellite(satellite: satellite): void
{
	satelliteIds[satellites.push(satellite) - 1] = satellite[0];

	const satelliteMesh = new Mesh(
		new SphereGeometry(0.125),
		new MeshPhongMaterial({
			color:0xffffff,
			flatShading: true
		})
	);

	satelliteMesh.position.x = 1.75;

	planet.add(satelliteMesh);
	satelliteMeshes.set(satellite, satelliteMesh);
}

camera.aspect = width / height;
camera.updateProjectionMatrix();

lightOpposite.position.set(
	1,
	-2,
	(
		0 -
		planetRadius * 4
	)
);
light.position.set(-1, 2, Math.abs(lightOpposite.position.z));

light.position.multiplyScalar(10);

rings.rotation.x = 90 * (Math.PI / 180);
rings.rotation.y = rings.rotation.z = 10 * (Math.PI / 180);

light.castShadow = true;
planet.receiveShadow = planet.castShadow = true;
rings.receiveShadow = rings.castShadow = true;

scene.add(light);
scene.add(lightOpposite);
scene.add(planet);

placeCameraInThreeDimensions(camera, 0, 0);

self.onmessage = (e: MessageEvent): void => {
	if ('offscreen' in e.data) {
		if ( ! (e.data.offscreen instanceof OffscreenCanvas)) {
			throw new Error('offscreen canvas was not supplied as expected!');
		} else if ( ! ('emojis' in e.data)) {
			throw new Error(
				'offscreen canvas was not passed along with emoji textures!'
			);
		} else if ('object' !== typeof e.data.emojis) {
			throw new Error('emoji textures were not passed as an object!');
		} else if (
			Object.values(
				e.data.emojis
			).length !== Object.values(e.data.emojis).filter(
				e => e instanceof ArrayBuffer
			).length
		) {
			throw new Error(
				'not all emoji textures were passed as ArrayBuffers!'
			);
		}

		canvas = e.data.offscreen as OffscreenCanvas;
		renderer = new WebGLRenderer({
			canvas,
			logarithmicDepthBuffer: true,
		});
		renderer.setSize(width, height, false);

		Object.values(points).forEach(point => {
			const [emoji] = point;

			if (emoji in e.data.emojis) {
				const material = (point[1].material as PointsMaterial);

				material.map = new DataTexture(
					new Uint8ClampedArray(e.data.emojis[emoji]),
					64,
					64,
					RGBAFormat
				);
				material.map.flipY = true;
				material.transparent = true;
			}
		});

		render();
	} else if (
		'resize' in e.data &&
		e.data.resize instanceof Array &&
		2 === e.data.resize.length &&
		Number.isSafeInteger(e.data.resize[0]) &&
		Number.isSafeInteger(e.data.resize[1])
	) {
		[width, height] = e.data.resize;

		if (canvas) {
			canvas.width = width;
			canvas.height = height;
			camera.aspect = width / height;
			camera.updateProjectionMatrix();

			if (renderer) {
				renderer.setSize(width, height, false);
			}
		}
	} else if (
		'updateMarker' in e.data &&
		e.data.updateMarker instanceof Array &&
		5 === e.data.updateMarker.length &&
		Number.isSafeInteger(e.data.updateMarker[0]) &&
		Number.isFinite(e.data.updateMarker[1]) &&
		Number.isFinite(e.data.updateMarker[2]) &&
		'string' === typeof e.data.updateMarker[3] &&
		'string' === typeof e.data.updateMarker[4]
	) {
		if ( ! markerIds.includes(e.data.updateMarker[0])) {
			addMarker(e.data.updateMarker);
		} else {
			const marker = markers[
				markerIds.indexOf(e.data.updateMarker[0])
			] as marker;

			marker[1] = e.data.updateMarker[1];
			marker[2] = e.data.updateMarker[2];
			marker[3] = e.data.updateMarker[3];

			placeMarkerInThreeDimensions(marker);
		}

		rebuildPointsData();
	} else if (
		'hasRings' in e.data &&
		'boolean' === typeof e.data.hasRings
	) {
		if (e.data.hasRings) {
			scene.add(rings);
		} else {
			scene.remove(rings);
		}
	} else if (
		'addSatellite' in e.data &&
		e.data.addSatellite instanceof Array &&
		1 === e.data.addSatellite.length &&
		Number.isSafeInteger(e.data.addSatellite[0])
	) {
		if ( ! satelliteIds.includes(e.data.addSatellite[0])) {
			addSatellite(e.data.addSatellite);
		}
	} else if (
		'changeColor' in e.data &&
		'string' === typeof e.data.changeColor &&
		/^[0-9a-f]{6}$/.test(e.data.changeColor)
	) {
		(
			planet.material as MeshPhongMaterial
		).color.setHex(parseInt(e.data.changeColor, 16));
	} else if (
		'cameraAuto' in e.data &&
		'boolean' === typeof e.data.cameraAuto
	) {
		cameraAuto = e.data.cameraAuto;

		if (e.data.cameraAuto) {
			placeCameraInThreeDimensions(camera, 0, 0);
		} else {
			placeCameraInThreeDimensions(camera, cameraLat, cameraLng);
		}
	} else if (
		'cameraLat' in e.data &&
		'cameraLng' in e.data &&
		Number.isFinite(e.data.cameraLat) &&
		Number.isFinite(e.data.cameraLng)
	) {
		cameraLat = e.data.cameraLat;
		cameraLng = e.data.cameraLng;

		placeCameraInThreeDimensions(camera, cameraLat, cameraLng);
	} else if (
		'cameraDistance' in e.data &&
		Number.isFinite(e.data.cameraDistance)
	) {
		cameraDistance = (
			e.data.cameraDistance
		);

		if ( ! cameraAuto) {
			placeCameraInThreeDimensions(camera, cameraLat, cameraLng);
		}
	} else {
		console.error(e);

		cancelAnimationFrame(cancelRender);

		throw new Error('unsupported message!');
	}
};
