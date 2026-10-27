"use client";

import {useEffect,useState,type ReactNode} from "react";
import { SessionProvider } from "next-auth/react";
import { SESSION_REFRESH_INTERVAL_SECONDS } from "../lib/auth-session-policy";

/** Refreshes the Auth.js JWT cookie in a writable response while the private app is open. */
export function SessionRefresh({ children }: { children: ReactNode }) {
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>{setHydrated(true);},[]);
  return (
    <SessionProvider
      refetchInterval={SESSION_REFRESH_INTERVAL_SECONDS}
      refetchOnWindowFocus={true}
      refetchWhenOffline={false}
    >
      {hydrated&&<span hidden data-private-hydrated="true"/>}
      {children}
    </SessionProvider>
  );
}
