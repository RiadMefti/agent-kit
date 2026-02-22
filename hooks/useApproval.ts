import { useRef, useCallback } from "react";
import type { ApprovalDecision, ApprovalRequest, ApprovalHandler } from "../client/types";

type SetMode = (mode: {
  kind: "approval";
  request: ApprovalRequest;
  resolve: (d: ApprovalDecision) => void;
}) => void;

export function useApproval(setMode: SetMode) {
  const sessionAllowed = useRef(new Set<string>());
  const sessionDenied = useRef(new Set<string>());
  const approvalQueueRef = useRef<Promise<void>>(Promise.resolve());

  const handleApprovalNeeded: ApprovalHandler = useCallback((request) => {
    if (sessionAllowed.current.has(request.name))
      return Promise.resolve("allow_always" as ApprovalDecision);
    if (sessionDenied.current.has(request.name))
      return Promise.resolve("deny_always" as ApprovalDecision);

    let outerResolve!: (d: ApprovalDecision) => void;
    const resultPromise = new Promise<ApprovalDecision>((res) => { outerResolve = res; });

    approvalQueueRef.current = approvalQueueRef.current.then(
      () => new Promise<void>((done) => {
        setMode({
          kind: "approval",
          request,
          resolve: (decision) => {
            if (decision === "allow_always") sessionAllowed.current.add(request.name);
            if (decision === "deny_always") sessionDenied.current.add(request.name);
            outerResolve(decision);
            done();
          },
        });
      })
    );

    return resultPromise;
  }, [setMode]);

  const clearApprovalCache = useCallback(() => {
    sessionAllowed.current.clear();
    sessionDenied.current.clear();
  }, []);

  return { handleApprovalNeeded, clearApprovalCache };
}
