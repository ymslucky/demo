"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Settings2Icon, PlayIcon, ZapIcon, Trash2Icon } from "./icons";

interface Token {
  id: number;
  rotate: number;
  /** 已被请求消费、正在播放离场动画（等效 AnimatePresence 的 exit） */
  leaving?: boolean;
}

export default function RateLimiterDemo() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [requests, setRequests] = useState<{ id: number; status: "pending" | "success" | "rejected" }[]>([]);
  
  // 交互控件
  const [capacity, setCapacity] = useState(8);
  const [rate, setRate] = useState(2); // 令牌数/秒
  
  const nextTokenId = useRef(0);
  const nextReqId = useRef(0);

  const tokensRef = useRef<Token[]>([]);

  // 令牌补充定时器
  useEffect(() => {
    const interval = setInterval(() => {
      if (tokensRef.current.length < capacity) {
        // 在渲染之外生成随机旋转角，保持 render 纯净
        const newToken: Token = { id: nextTokenId.current++, rotate: Math.random() * 20 - 10 };
        tokensRef.current = [...tokensRef.current, newToken];
        // 仍在离场动画中的令牌尚未移除，需要一并保留在渲染列表里
        setTokens((prev) => [...prev.filter((t) => t.leaving), ...tokensRef.current]);
      }
    }, 1000 / rate);
    return () => clearInterval(interval);
  }, [capacity, rate]);

  // 处理请求队列
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
          // 被消费的令牌先标记离场（缩小淡出），动画结束后再真正移除
          const leavingIds = new Set(tokensRef.current.slice(0, consumed).map((t) => t.id));
          tokensRef.current = tokensRef.current.slice(consumed);
          setTokens((prev) =>
            prev.map((t) => (leavingIds.has(t.id) ? { ...t, leaving: true } : t))
          );
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
        <Settings2Icon size={24} style={{ color: "var(--color-primary)" }} />
        <h3 style={{ margin: 0 }}>交互式演示：令牌桶 (Token Bucket)</h3>
      </div>
      
      {/* 控制面板 */}
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
        {/* 令牌桶可视化 */}
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
            {/* 液位指示 */}
            <div className="absolute top-2 left-2 text-xs font-mono font-bold text-text-muted opacity-50">
              {tokens.filter((t) => !t.leaving).length} / {capacity}
            </div>

            {tokens.map((token) => (
              <div
                key={token.id}
                className={`demo-token${token.leaving ? " demo-token--leaving" : ""}`}
                style={{ "--token-rotate": `${token.rotate}deg` } as CSSProperties}
                onAnimationEnd={(event) => {
                  // 仅在离场动画结束时移除，入场动画的结束事件需忽略
                  if (event.animationName === "demo-token-vanish") {
                    setTokens((prev) => prev.filter((t) => t.id !== token.id));
                  }
                }}
              >
                {/* 令牌高光效果 */}
                <div className="absolute top-0 left-0 w-full h-1/2 bg-white opacity-20"></div>
                <span>T-{token.id % 100}</span>
              </div>
            ))}
          </div>
          
          <div className="mt-6 flex flex-col items-center">
            <div
              className="demo-gear"
              style={{ animationDuration: `${10 / rate}s` }}
              aria-hidden="true"
            >
              ⚙️
            </div>
            <p className="text-xs font-bold text-text-muted text-center uppercase tracking-widest">
              Generator<br/>{rate}/sec
            </p>
          </div>
        </div>

        {/* 操作与请求可视化 */}
        <div className="demo-col flex-1">
          <div className="flex flex-wrap justify-center gap-3 mb-8 w-full">
            <button 
              className="btn btn--primary flex items-center gap-2" 
              onClick={() => sendRequest(1)}
            >
              <PlayIcon size={16} />
              单次请求
            </button>
            <button 
              className="btn flex items-center gap-2 bg-accent text-white border-3 border-border shadow-[4px_4px_0px_0px_var(--color-border)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_0px_var(--color-border)] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all font-bold px-4 py-2 uppercase"
              onClick={() => sendRequest(5)}
            >
              <ZapIcon size={16} />
              瞬时并发 x5
            </button>
          </div>
          
          <div className="w-full max-w-sm bg-bg border-4 border-border rounded-lg p-4 min-h-[300px] shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.05)] relative">
            <div className="flex justify-between items-center mb-4 border-b-2 border-border pb-2">
              <span className="font-bold text-sm uppercase tracking-wider">请求网关 (Gateway)</span>
              <button onClick={clearRequests} className="text-text-muted hover:text-err-text transition-colors" title="Clear Queue">
                <Trash2Icon size={16} style={{ color: "var(--color-text-muted)" }} />
              </button>
            </div>
            
            <div className="demo-req-list flex flex-col gap-2">
              {requests.length === 0 && (
                <div className="demo-empty text-center text-text-muted text-sm py-8 font-mono">
                  等待流量接入...
                </div>
              )}
              {requests.map((req) => (
                <div
                  key={req.id}
                  className={`demo-req p-3 border-3 rounded-md font-bold text-sm flex justify-between items-center shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] ${
                    req.status === 'success' ? 'demo-req--success' :
                    req.status === 'rejected' ? 'demo-req--rejected' :
                    ''
                  }`}
                >
                  <span className="font-mono">REQ_{String(req.id).padStart(3, '0')}</span>
                  <span className="uppercase text-xs tracking-wider bg-white/50 px-2 py-1 rounded border border-current">
                    {req.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
