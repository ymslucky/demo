/**
 * Clerk basic RBAC 全局类型（参考 https://clerk.com/docs/guides/secure/basic-rbac）。
 *
 * 角色存于用户 publicMetadata.role，并通过 Clerk Dashboard 的 session token
 * 定制（Sessions → Customize session token）注入会话 claims.metadata：
 *   { "metadata": "{{user.public_metadata}}" }
 * 注入后角色随 JWT 签名下发——服务端（auth().sessionClaims）与边缘/agents
 * 验签后可直读，无需回源；未配置定制时无该 claim，一切判定 fail-closed。
 */

export type Roles = "admin" | "moderator";

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      // null：publicMetadata.role 被移除时随插值进入 claims。
      role?: Roles | null;
    };
  }

  // 与 @clerk/shared 的全局 UserPublicMetadata（索引签名 [k: string]:
  // unknown）声明合并：role 字段获得精确类型（Nav/useUser 读取；移除角色
  // 时后端写入 null）。
  interface UserPublicMetadata {
    role?: Roles | null;
  }
}
