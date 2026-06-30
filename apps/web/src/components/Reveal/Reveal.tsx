"use client";

import {
  type ElementType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./reveal.module.css";

type RevealVariant = "up" | "scale" | "left" | "right";

interface RevealProps {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  variant?: RevealVariant;
  className?: string;
}

export default function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  variant = "up",
  className = "",
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`${styles.reveal} ${styles[variant]} ${shown ? styles.shown : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
