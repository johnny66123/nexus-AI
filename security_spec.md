# NEXUS AI v3.0 — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict User Ownership**: Every user-owned document (`assistants`, `conversations`, `messages`, `researchProjects`, `researchSources`, `specialistAgents`, `agentTasks`, `providerSettings`, `usageRecords`) resides beneath `/users/{userId}/...` where `userId == request.auth.uid`.
2. **Email Verification Gate**: All authenticated writes require `request.auth.token.email_verified == true`.
3. **Immutable Identity & Timestamps**: `userId`/`ownerUserId` and `createdAt` cannot be modified after creation (`incoming().userId == existing().userId` and `incoming().createdAt == existing().createdAt`); `createdAt == request.time` on create and `updatedAt == request.time` on update.
4. **No Self-Assigned Roles**: Regular users cannot assign or escalate their own `role` or `status` fields on `/users/{userId}`; only verified admins can mutate governance roles.
5. **Path Variable Hardening**: Every single-document `get`, `create`, `update`, and `delete` rule validates path IDs via `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
6. **Strict Schema & Size Enforcement**: Every collection uses a standalone `isValid[Entity](data)` helper enforcing `keys().hasAll(...)`, `keys().hasOnly(...)`, exact primitive types, and explicit `.size()` bounds on every string and array.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: Read `/users/uid-1/assistants/asst-1` with `auth == null`.
2. **Unverified Email Write**: Create `/users/uid-1/assistants/asst-1` with `auth.uid == 'uid-1'` and `email_verified == false`.
3. **Cross-User Read**: User `uid-2` attempts `get` on `/users/uid-1/researchProjects/proj-1`.
4. **Cross-User List**: User `uid-2` attempts `list` on `/users/uid-1/usageRecords`.
5. **Identity Spoofing on Create**: User `uid-1` creates `/users/uid-1/assistants/asst-2` with `ownerUserId: 'uid-2'`.
6. **Privilege Escalation on User Profile**: User `uid-1` updates `/users/uid-1` setting `role: 'admin'`.
7. **Shadow / Ghost Field Injection**: User `uid-1` updates `/users/uid-1/providerSettings/anthropic` including `isBypassed: true`.
8. **ID Poisoning**: User `uid-1` creates `/users/uid-1/agentTasks/../../../bad..id` or a 300-char ID.
9. **Resource Exhaustion (1MB String)**: User `uid-1` writes 200KB into `instructions` on `/users/uid-1/specialistAgents/agent-1`.
10. **Timestamp Spoofing**: User `uid-1` creates `/users/uid-1/usageRecords/rec-1` with backdated `createdAt`.
11. **Terminal State Mutation**: User `uid-1` updates `/users/uid-1/agentTasks/task-1` after `status == 'completed'`.
12. **Immutable Ownership Mutation**: User `uid-1` updates `/users/uid-1/conversations/conv-1` changing `userId` to `'uid-2'`.
