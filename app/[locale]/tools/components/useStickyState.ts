import { useState, useEffect, useRef } from "react";

export function useStickyState<T>(defaultValue: T, key: string): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(defaultValue);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const stickyValue = window.localStorage.getItem(key);
    if (stickyValue !== null) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(JSON.parse(stickyValue));
      } catch {
         
        setValue(stickyValue as unknown as T);
      }
    }
  }, [key]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
