"use client";

import { useEffect, useState } from "react";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../lib/skippy-api";

export function AuthStatus() {
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const ensureViewer = useMutation(api.auth.ensureViewer);
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip") as
    | { brain?: { displayName?: string } | null }
    | null
    | undefined;
  const [bootstrapping, setBootstrapping] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || viewer !== null || bootstrapping) {
      return;
    }

    setBootstrapping(true);
    void ensureViewer({}).finally(() => setBootstrapping(false));
  }, [bootstrapping, ensureViewer, isAuthenticated, viewer]);

  if (!isClerkLoaded || (isSignedIn && isConvexAuthLoading)) {
    return <span className="badge">Connecting</span>;
  }

  return (
    <div className="auth-controls">
      {!isSignedIn ? (
        <SignInButton mode="modal">
          <button className="text-button" type="button">
            Sign in
          </button>
        </SignInButton>
      ) : (
        <>
          <span className="badge blue">{isAuthenticated ? viewer?.brain?.displayName ?? "Skippy" : "Connecting Convex"}</span>
          <UserButton />
        </>
      )}
    </div>
  );
}

export function LiveGate({ children }: { children: React.ReactNode }) {
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip");

  if (!isClerkLoaded || isLoading || (isAuthenticated && viewer === undefined)) {
    return (
      <section className="card section">
        <h2>Loading brain</h2>
        <p className="muted">Connecting to Convex and checking your brain instance.</p>
      </section>
    );
  }

  if (!isSignedIn) {
    return (
      <section className="card section">
        <h2>Sign in</h2>
        <p className="muted">Use Clerk to connect your Skippy brain.</p>
        <SignInButton mode="modal">
          <button className="text-button" type="button">
            Sign in with Clerk
          </button>
        </SignInButton>
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="card section">
        <h2>Connecting Convex</h2>
        <p className="muted">Clerk sign-in is active. Waiting for Convex to accept the session token.</p>
      </section>
    );
  }

  return <>{children}</>;
}
