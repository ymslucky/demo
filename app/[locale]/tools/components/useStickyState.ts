import { useState, useEffect } from "react";

export function useStickyState<T>(defaultValue: T, key: string): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(defaultValue);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const stickyValue = window.localStorage.getItem(key);
    if (stickyValue !== null) {
      try {
        setValue(JSON.parse(stickyValue));
      } catch {
        setValue(stickyValue as unknown as T);
      }
    }
  }, [key]);

  useEffect(() => {
    if (isMounted) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  }, [key, value, isMounted]);

  return [value, setValue];
}
