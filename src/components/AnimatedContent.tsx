// Adapted from React Bits AnimatedContent (David Haz).
// Uses the existing Motion runtime and respects reduced-motion preferences.
// Source: https://reactbits.dev/animations/animated-content
// License: ../../licenses/react-bits.md
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export function AnimatedContent({ children, className, delay=0 }: {children:ReactNode;className?:string;delay?:number}) {
  const reduced=useReducedMotion();
  return <motion.div className={className} initial={reduced?false:{opacity:0,y:12}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:0.08}} transition={{duration:reduced?0:0.45,delay:reduced?0:delay,ease:[0.22,1,0.36,1]}}>{children}</motion.div>;
}
