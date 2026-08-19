"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Environment } from "@react-three/drei";
import { useRef, useEffect, useState } from "react";
import * as THREE from "three";

function FloatingGeometry({ isZooming }: { isZooming: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Slow rotation
    meshRef.current.rotation.y += delta * 0.05;
    meshRef.current.rotation.x += delta * 0.02;

    // Camera zoom logic
    if (isZooming) {
      // Zoom into the object slowly (1.4s~2.2s transition feel)
      state.camera.position.lerp(new THREE.Vector3(0, 0, 1.5), 0.03);
    } else {
      // Normal camera position
      state.camera.position.lerp(new THREE.Vector3(0, 0, 8), 0.05);
    }
  });

  return (
    <Float
      speed={1} 
      rotationIntensity={0.5} 
      floatIntensity={0.5}
      floatingRange={[-0.5, 0.5]}
    >
      <mesh ref={meshRef} position={[0, 0, 0]} castShadow receiveShadow>
        <torusKnotGeometry args={[1.5, 0.4, 128, 32]} />
        <meshStandardMaterial 
          color="#d4b58e"
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>
    </Float>
  );
}

export default function Scene() {
  const [isZooming, setIsZooming] = useState(false);

  // Listen to custom event for navigation
  useEffect(() => {
    const handleNavStart = () => setIsZooming(true);
    const handleNavEnd = () => setIsZooming(false);
    
    window.addEventListener("nav-start", handleNavStart);
    window.addEventListener("nav-end", handleNavEnd);
    
    return () => {
      window.removeEventListener("nav-start", handleNavStart);
      window.removeEventListener("nav-end", handleNavEnd);
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none", opacity: 0.6 }}>
      <Canvas shadows camera={{ position: [0, 0, 8], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <directionalLight 
          castShadow 
          position={[5, 10, 5]} 
          intensity={1.5} 
          shadow-mapSize={1024}
        />
        <FloatingGeometry isZooming={isZooming} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
