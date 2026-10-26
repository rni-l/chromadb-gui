import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const keys = {
  connections: ["connections"] as const,
  status: (cid: string) => ["status", cid] as const,
  databases: (cid: string) => ["databases", cid] as const,
  collections: (cid: string, db: string) => ["collections", cid, db] as const,
  collection: (cid: string, db: string, name: string) => ["collection", cid, db, name] as const,
  records: (cid: string, db: string, name: string) => ["records", cid, db, name] as const,
  profiles: ["profiles"] as const,
  settings: ["settings"] as const,
  migrations: ["migrations"] as const,
};

export const useConnections = () => useQuery({ queryKey: keys.connections, queryFn: api.connections.list });

export const useDatabases = (cid: string | undefined) =>
  useQuery({ queryKey: keys.databases(cid ?? ""), queryFn: () => api.databases.list(cid!), enabled: Boolean(cid) });

export const useCollections = (cid: string | undefined, db: string | undefined) =>
  useQuery({
    queryKey: keys.collections(cid ?? "", db ?? ""),
    queryFn: async () => (await api.collections.list(cid!, db!)).sort((a, b) => a.name.localeCompare(b.name)),
    enabled: Boolean(cid && db),
  });

export const useCollection = (cid: string, db: string, name: string) =>
  useQuery({ queryKey: keys.collection(cid, db, name), queryFn: () => api.collections.get(cid, db, name) });

export const useProfiles = () => useQuery({ queryKey: keys.profiles, queryFn: api.profiles.list });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings.get });

/** Invalidate everything that depends on a collection's contents. */
export function useInvalidateCollection() {
  const qc = useQueryClient();
  return (cid: string, db: string, name?: string) => {
    qc.invalidateQueries({ queryKey: keys.collections(cid, db) });
    if (name) {
      qc.invalidateQueries({ queryKey: keys.collection(cid, db, name) });
      qc.invalidateQueries({ queryKey: keys.records(cid, db, name) });
    }
  };
}
