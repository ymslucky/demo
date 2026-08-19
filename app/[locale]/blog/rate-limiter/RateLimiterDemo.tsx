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
    <div className="card my-8">
      <h3 className="mb-4">Token Bucket Interactive Demo</h3>
      
      <div className="flex flex-col md:flex-row gap-8">
        {/* Bucket visualization */}
        <div className="flex-1 flex flex-col items-center">
          <p className="mb-2 font-bold text-sm">Bucket (Capacity: {capacity})</p>
          <div 
            className="w-32 h-48 border-4 border-t-0 border-current rounded-b-xl relative flex flex-col-reverse p-2 gap-2 overflow-hidden bg-surface"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <AnimatePresence>
              {tokens.map((id) => (
                <motion.div
                  key={id}
                  initial={{ y: -100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="w-full h-6 rounded-md"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                />
              ))}
            </AnimatePresence>
          </div>
          <p className="mt-4 text-xs opacity-70">Refill: {rate} token/sec</p>
        </div>

        {/* Requests visualization */}
        <div className="flex-1 flex flex-col items-center">
          <button 
            className="btn btn--primary mb-6" 
            onClick={sendRequest}
          >
            Send Request
          </button>
          
          <div className="w-full max-w-xs flex flex-col gap-2">
            <AnimatePresence>
              {requests.map((req) => (
                <motion.div
                  key={req.id}
                  initial={{ x: 50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className={`p-2 border-2 rounded text-center font-bold text-sm ${
                    req.status === 'success' ? 'bg-[#d1fae5] text-[#065f46] border-[#1c1917]' : 
                    req.status === 'rejected' ? 'bg-[#fee2e2] text-[#991b1b] border-[#1c1917]' : 
                    'bg-surface text-current border-current'
                  }`}
                  style={req.status === 'pending' ? { borderColor: 'var(--color-border)' } : {}}
                >
                  Request #{req.id} - {req.status.toUpperCase()}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
