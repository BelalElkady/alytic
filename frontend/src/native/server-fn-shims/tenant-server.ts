import { api } from "@/lib/api";
import { DEFAULT_TENANT, type Tenant } from "@/lib/tenant";

/** Native build: no server functions, so the tenant comes straight from the public API. */
export const getTenant = async (): Promise<Tenant> => {
  try {
    return await api<Tenant>("/api/tenant");
  } catch {
    return DEFAULT_TENANT;
  }
};
