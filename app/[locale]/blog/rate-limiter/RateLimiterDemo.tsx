"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";

export default function RateLimiterDemo() {
  const [tokens, setTokens] = useState<number[]>([]);
  const [requests, setRequests] = useState<{ id: number; status: "pending" | "success" | "rejected" }[]>([]);
  const [capacity] = useState(5);
  const [rate] = useState(1); // 1 token per second
  const nextTokenId = useRef(0);
  const nextReqId = useRef(0);

  // Token refill interval
  useEffect(() => {
    const interval = setInterval(() => {
      setTokens((prev) => {
        if (prev.length < capacity) {
          const newTokens = [...prev, nextTokenId.current++];
          return newTokens;
        }
        return prev;
      });
    }, 1000 / rate);
    return () => clearInterval(interval);
  }, [capacity, rate]);

  // Process requests
  useEffect(() => {
    const processQueue = () => {
      setRequests((prevReqs) => {
        const hasPending = prevReqs.some(r => r.status === "pending");
        if (!hasPending) return prevReqs;

        let tokensConsumed = 0;
        const newReqs = prevReqs.map((req) => {
          if (req.status === "pending") {
            // Check if we can consume a token
            let tokenAvailable = false;
            setTokens(prevTokens => {
              if (prevTokens.length > tokensConsumed) {
                tokenAvailable = true;
                return prevTokens;
              }
              return prevTokens;
            });

            if (tokenAvailable) {
              tokensConsumed++;
              return { ...req, status: "success" };
            } else {
              return { ...req, status: "rejected" };
            }
          }
          return req;
        });

        if (tokensConsumed > 0) {
          setTokens(prev => prev.slice(tokensConsumed));
        }

        return newReqs;
      });
    };

    const interval = setInterval(processQueue, 100);
    return () => clearInterval(interval);
  }, []);

  const sendRequest = () => {
    setRequests((prev) => [
      { id: nextReqId.current++, status: "pending" },
      ...prev,
    ].slice(0, 10)); // Keep last 10 requests
  };

  return (
    <div className="demo-container">
      <h3 style={{ marginTop: 0, marginBottom: 'var(--space-md)' }}>Token Bucket Interactive Demo</h3>
      
      <div className="demo-layout">
        {/* Bucket visualization */}
        <div className="demo-col">
          <p style={{ marginBottom: 'var(--space-sm)', fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
            Bucket (Capacity: {capacity})
          </p>
          <div className="demo-bucket">
            <AnimatePresence>
              {tokens.map((id) => (
                <motion.div
                  key={id}
                  initial={{ y: -100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="demo-token"
                />
              ))}
            </AnimatePresence>
          </div>
          <p style={{ marginTop: 'var(--space-md)', fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            Refill: {rate} token/sec
          </p>
        </div>

        {/* Requests visualization */}
        <div className="demo-col">
          <button 
            className="btn btn--primary" 
            style={{ marginBottom: 'var(--space-lg)' }}
            onClick={sendRequest}
          >
            Send Request
          </button>
          
          <div className="demo-queue">
            <AnimatePresence>
              {requests.map((req) => (
                <motion.div
                  key={req.id}
                  initial={{ x: 50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className={`demo-req ${
                    req.status === 'success' ? 'demo-req--success' : 
                    req.status === 'rejected' ? 'demo-req--rejected' : ''
                  }`}
                >
                  Request #{req.id} - {req.status}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
