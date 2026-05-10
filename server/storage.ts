export type { IStorage, AiTrainingStats } from "./storage.types";

import { DatabaseStorage } from "./database-storage";

// Use PostgreSQL storage for persistent data
export const storage = new DatabaseStorage();
