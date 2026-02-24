import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { storage } from "../storage";
import type { UpdateHistory, InsertUpdateHistory, UpdateStatus } from "@shared/schema";

const execAsync = promisify(exec);

const UPDATES_DIR = "/tmp/updates";
const BACKUPS_DIR = "/tmp/backups";
const PROJECT_ROOT = process.cwd();

const ALLOWED_UPDATE_DIRS = ["server", "client", "shared"];

export interface UpdateManifest {
  version: string;
  changelog?: string;
  files: string[];
  preScript?: string;
  postScript?: string;
}

export class UpdateService {
  async init() {
    await fs.mkdir(UPDATES_DIR, { recursive: true });
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    console.log("[UpdateService] Initialized directories");
  }

  async calculateChecksum(buffer: Buffer): Promise<string> {
    return createHash("sha256").update(buffer).digest("hex");
  }

  async processUpload(
    fileBuffer: Buffer,
    filename: string,
    version: string,
    changelog?: string
  ): Promise<UpdateHistory> {
    await this.init();

    const checksum = await this.calculateChecksum(fileBuffer);
    const uploadPath = path.join(UPDATES_DIR, `${checksum}.zip`);

    await fs.writeFile(uploadPath, fileBuffer);

    const update = await storage.createUpdate({
      version,
      filename,
      fileSize: fileBuffer.length,
      checksum,
      changelog: changelog || null,
      status: "pending" as UpdateStatus,
    });

    console.log(`[UpdateService] Uploaded update ${version} (${filename})`);
    return update;
  }

  private isPathSafe(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    if (normalized.includes("..") || path.isAbsolute(normalized)) {
      return false;
    }
    const firstDir = normalized.split(path.sep)[0];
    return ALLOWED_UPDATE_DIRS.includes(firstDir);
  }

  async applyUpdate(updateId: string, userId: string): Promise<{ success: boolean; message: string }> {
    const update = await storage.getUpdateById(updateId);
    if (!update) {
      return { success: false, message: "Обновление не найдено" };
    }

    if (update.status === "applied") {
      return { success: false, message: "Обновление уже применено" };
    }

    const zipPath = path.join(UPDATES_DIR, `${update.checksum}.zip`);
    
    try {
      await fs.access(zipPath);
    } catch {
      return { success: false, message: "Файл обновления не найден" };
    }

    const backupPath = await this.createBackup(update.version);
    
    await storage.setUpdateBackupPath(updateId, backupPath);

    const extractDir = path.join(UPDATES_DIR, `extract_${update.id}`);
    const copiedFiles: string[] = [];

    try {
      await fs.mkdir(extractDir, { recursive: true });

      await execAsync(`unzip -o "${zipPath}" -d "${extractDir}"`);

      const manifestPath = path.join(extractDir, "update.json");
      let manifest: UpdateManifest | null = null;
      
      try {
        const manifestContent = await fs.readFile(manifestPath, "utf-8");
        manifest = JSON.parse(manifestContent);
      } catch {
        console.log("[UpdateService] No manifest found, applying all files");
      }

      const filesToCopy = manifest?.files || await this.getAllFiles(extractDir);
      
      for (const file of filesToCopy) {
        if (file === "update.json") continue;
        
        if (!this.isPathSafe(file)) {
          throw new Error(`Небезопасный путь файла: ${file}. Разрешены только: ${ALLOWED_UPDATE_DIRS.join(", ")}`);
        }

        const srcPath = path.join(extractDir, file);
        const destPath = path.join(PROJECT_ROOT, file);
        
        const realDest = path.resolve(destPath);
        if (!realDest.startsWith(PROJECT_ROOT)) {
          throw new Error(`Попытка записи за пределы проекта: ${file}`);
        }
        
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
        copiedFiles.push(file);
        console.log(`[UpdateService] Copied: ${file}`);
      }

      await fs.rm(extractDir, { recursive: true, force: true });

      // Run postScript if defined in manifest (e.g., "npm run build")
      if (manifest?.postScript) {
        console.log(`[UpdateService] Running postScript: ${manifest.postScript}`);
        try {
          const { stdout, stderr } = await execAsync(manifest.postScript, { 
            cwd: PROJECT_ROOT, 
            timeout: 180000 // 3 minutes
          });
          if (stdout) console.log("[UpdateService] postScript stdout:", stdout.slice(0, 500));
          if (stderr) console.log("[UpdateService] postScript stderr:", stderr.slice(0, 500));
          console.log("[UpdateService] postScript completed successfully");
        } catch (scriptError: any) {
          console.error("[UpdateService] postScript failed:", scriptError.message);
          return {
            success: true,
            message: `Обновление ${update.version} применено, но postScript не выполнен: ${scriptError.message}`
          };
        }
      }

      await storage.updateUpdateStatus(updateId, "applied");
      
      console.log(`[UpdateService] Update ${update.version} applied successfully`);
      return { 
        success: true, 
        message: `Обновление ${update.version} успешно применено. Перезапустите сервер для применения изменений.` 
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      console.error("[UpdateService] Update failed:", errorMessage);
      
      if (copiedFiles.length > 0) {
        console.log("[UpdateService] Attempting auto-rollback...");
        try {
          await this.restoreFromBackup(backupPath, copiedFiles);
          console.log("[UpdateService] Auto-rollback successful");
        } catch (rollbackError) {
          console.error("[UpdateService] Auto-rollback failed:", rollbackError);
        }
      }
      
      try {
        await fs.rm(extractDir, { recursive: true, force: true });
      } catch {}
      
      await storage.updateUpdateStatus(updateId, "failed", errorMessage);
      
      return { 
        success: false, 
        message: `Ошибка применения обновления: ${errorMessage}. Выполнен автоматический откат.` 
      };
    }
  }
  
  private async restoreFromBackup(backupPath: string, files: string[]): Promise<void> {
    for (const file of files) {
      const backupFile = path.join(backupPath, file);
      const destFile = path.join(PROJECT_ROOT, file);
      
      try {
        await fs.access(backupFile);
        await fs.copyFile(backupFile, destFile);
        console.log(`[UpdateService] Restored: ${file}`);
      } catch {
        try {
          await fs.unlink(destFile);
          console.log(`[UpdateService] Removed new file: ${file}`);
        } catch {}
      }
    }
  }

  async createBackup(version: string): Promise<string> {
    await this.init();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `backup_${version}_${timestamp}`;
    const backupPath = path.join(BACKUPS_DIR, backupName);

    const keyDirs = ["server", "client/src", "shared"];
    const keyFiles = ["package.json", "tsconfig.json"];

    await fs.mkdir(backupPath, { recursive: true });

    for (const dir of keyDirs) {
      const srcDir = path.join(PROJECT_ROOT, dir);
      const destDir = path.join(backupPath, dir);
      
      try {
        await fs.access(srcDir);
        await execAsync(`cp -r "${srcDir}" "${destDir}"`);
      } catch {
        console.log(`[UpdateService] Skipping backup of ${dir} (not found)`);
      }
    }

    for (const file of keyFiles) {
      const srcFile = path.join(PROJECT_ROOT, file);
      const destFile = path.join(backupPath, file);
      
      try {
        await fs.access(srcFile);
        await fs.copyFile(srcFile, destFile);
      } catch {
        console.log(`[UpdateService] Skipping backup of ${file} (not found)`);
      }
    }

    console.log(`[UpdateService] Backup created: ${backupPath}`);
    return backupPath;
  }

  async rollback(updateId: string): Promise<{ success: boolean; message: string }> {
    const update = await storage.getUpdateById(updateId);
    if (!update) {
      return { success: false, message: "Обновление не найдено" };
    }

    if (!update.backupPath) {
      return { success: false, message: "Резервная копия не найдена" };
    }

    try {
      await execAsync(`cp -r "${update.backupPath}/"* "${PROJECT_ROOT}/"`);
      
      await storage.updateUpdateStatus(updateId, "rolled_back");
      
      return { 
        success: true, 
        message: "Откат выполнен успешно. Требуется перезагрузка." 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      return { success: false, message: `Ошибка отката: ${errorMessage}` };
    }
  }

  async getHistory(): Promise<UpdateHistory[]> {
    return storage.getUpdateHistory();
  }

  async getCurrentVersion(): Promise<string> {
    return storage.getCurrentVersion();
  }

  private async getAllFiles(dir: string, baseDir: string = dir): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        const subFiles = await this.getAllFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }
}

export const updateService = new UpdateService();
