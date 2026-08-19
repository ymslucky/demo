"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Play, Settings2, Trash2 } from "lucide-react";

interface Token {
  id: number;
  rotate: number;
}

export default function RateLimiterDemo() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [requests, setRequests] = useState<{ id: number; status: "pending" | "success" | "rejected" }[]>([]);
  
  // Interactive controls
  const [capacity, setCapacity] = useState(8);
  const [rate, setRate] = useState(2); // tokens per second
  
  const nextTokenId = useRef(0);
  const nextReqId = useRef(0);

  const tokensRef = useRef<Token[]>([]);

  // Token refill interval
  useEffect(() => {
    const interval = setInterval(() => {
      if (tokensRef.current.length < capacity) {
        // Generate random rotation outside render to keep render pure
        const newToken: Token = { id: nextTokenId.current++, rotate: Math.random() * 20 - 10 };
        tokensRef.current = [...tokensRef.current, newToken];
        setTokens([...tokensRef.current]);
      }
    }, 1000 / rate);
    return () => clearInterval(interval);
  }, [capacity, rate]);

  // Process requests queue
  useEffect(() => {
    const processQueue = () => {
      setRequests((prevReqs) => {
        const hasPending = prevReqs.some(r => r.status === "pending");
        if (!hasPending) return prevReqs;

        let consumed = 0;
        const newReqs = prevReqs.map((req) => {
          if (req.status === "pending") {
            if (tokensRef.current.length > consumed) {
              consumed++;
              return { ...req, status: "success" as const };
            } else {
              return { ...req, status: "rejected" as const };
            }
          }
          return req;
        });

        if (consumed > 0) {
          tokensRef.current = tokensRef.current.slice(consumed);
          setTokens([...tokensRef.current]);
        }

        return newReqs;
      });
    };

    const interval = setInterval(processQueue, 150);
    return () => clearInterval(interval);
  }, []);

  const sendRequest = (count: number = 1) => {
    const newReqs = Array.from({ length: count }).map(() => ({
      id: nextReqId.current++,
      status: "pending" as const
    }));
    
    setRequests((prev) => [...newReqs, ...prev].slice(0, 15));
  };

  const clearRequests = () => {
    setRequests([]);
  };

  return (
    <div className="demo-container overflow-hidden relative">
      <div className="flex items-center gap-2 mb-6 border-b-4 border-border pb-4">
        <Settings2 className="w-6 h-6 text-primary" />
        <h3 style={{ margin: 0 }}>交互式演示：令牌桶 (Token Bucket)</h3>
      </div>
      
      {/* Controls */}
      <div className="flex flex-wrap gap-6 mb-8 bg-tint p-4 rounded-md border-2 border-border shadow-[2px_2px_0px_0px_var(--color-border)]">
        <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
          <label className="text-sm font-bold flex justify-between">
            <span>桶容量 (Capacity)</span>
            <span className="text-primary">{capacity} 个</span>
          </label>
          <input 
            type="range" 
            min="1" max="15" 
            value={capacity} 
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
        <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
          <label className="text-sm font-bold flex justify-between">
            <span>发放速率 (Refill Rate)</span>
            <span className="text-primary">{rate} 个/秒</span>
          </label>
          <input 
            type="range" 
            min="1" max="10" 
            value={rate} 
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      </div>

      <div className="demo-layout">
        {/* Bucket Visualization */}
        <div className="demo-col relative">
          <p className="font-bold mb-4 bg-surface px-4 py-1 border-2 border-border rounded-full shadow-[2px_2px_0px_0px_var(--color-border)] z-10">
            令牌桶
          </p>
          
          <div 
            className="demo-bucket"
            style={{ 
              height: '280px', 
              width: '160px',
              backgroundColor: 'var(--color-surface)',
              boxShadow: 'inset 0 -10px 20px rgba(0,0,0,0.05), 6px 6px 0px 0px var(--color-border)'
            }}
          >
            {/* Fill Level Indicator */}
            <div className="absolute top-2 left-2 text-xs font-mono font-bold text-text-muted opacity-50">
              {tokens.length} / {capacity}
            </div>

            <AnimatePresence>
              {tokens.map((token) => (
                <motion.div
                  key={token.id}
                  initial={{ y: -150, scale: 0.5, opacity: 0, rotate: token.rotate }}
                  animate={{ y: 0, scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ type: "spring", bounce: 0.6, duration: 0.6 }}
                  className="w-full h-6 bg-primary rounded-sm border-2 border-border shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)] relative overflow-hidden flex items-center justify-center"
                >
                  {/* Token shine effect */}
                  <div className="absolute top-0 left-0 w-full h-1/2 bg-white opacity-20"></div>
                  <span className="text-[10px] font-mono text-white opacity-60">T-{token.id % 100}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          
          <div className="mt-6 flex flex-col items-center">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 10 / rate, ease: "linear" }}
              className="text-text-muted mb-2"
            >
              ⚙️
            </motion.div>
            <p className="text-xs font-bold text-text-muted text-center uppercase tracking-widest">
              Generator<br/>{rate}/sec
            </p>
          </div>
        </div>

        {/* Action & Requests Visualization */}
        <div className="demo-col flex-1">
          <div className="flex flex-wrap justify-center gap-3 mb-8 w-full">
            <button 
              className="btn btn--primary flex items-center gap-2" 
              onClick={() => sendRequest(1)}
            >
              <Play className="w-4 h-4" />
              单次请求
            </button>
            <button 
              className="btn flex items-center gap-2 bg-accent text-white border-3 border-border shadow-[4px_4px_0px_0px_var(--color-border)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_0px_var(--color-border)] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all font-bold px-4 py-2 uppercase"
              onClick={() => sendRequest(5)}
            >
              <Zap className="w-4 h-4" />
              瞬时并发 x5
            </button>
          </div>
          
          <div className="w-full max-w-sm bg-bg border-4 border-border rounded-lg p-4 min-h-[300px] shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.05)] relative">
            <div className="flex justify-between items-center mb-4 border-b-2 border-border pb-2">
              <span className="font-bold text-sm uppercase tracking-wider">请求网关 (Gateway)</span>
              <button onClick={clearRequests} className="text-text-muted hover:text-err-text transition-colors" title="Clear Queue">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
              <AnimatePresence mode="popLayout">
                {requests.length === 0 && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-center text-text-muted text-sm py-8 font-mono"
                  >
                    等待流量接入...
                  </motion.div>
                )}
                {requests.map((req) => (
                  <motion.div
                    layout
                    key={req.id}
                    initial={{ x: 50, opacity: 0, scale: 0.9 }}
                    animate={{ 
                      x: req.status === 'rejected' ? [0, -10, 10, -10, 10, 0] : 0, 
                      opacity: 1, 
                      scale: 1 
                    }}
                    transition={{ 
                      x: { type: "spring", stiffness: 300, damping: 10 },
                      layout: { type: "spring", bounce: 0.2, duration: 0.4 }
                    }}
                    className={`p-3 border-3 rounded-md font-bold text-sm flex justify-between items-center shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] ${
                      req.status === 'success' ? 'bg-info-bg text-info-text border-info-border' : 
                      req.status === 'rejected' ? 'bg-err-bg text-err-text border-err-border' : 
                      'bg-surface text-text border-border'
                    }`}
                  >
                    <span className="font-mono">REQ_{String(req.id).padStart(3, '0')}</span>
                    <span className="uppercase text-xs tracking-wider bg-white/50 px-2 py-1 rounded border border-current">
                      {req.status}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
