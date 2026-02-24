import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { insertProductSchema } from "@shared/schema";
import { requireAuth, requirePermission } from "../middleware/rbac";

const router = Router();

router.get("/api/products", requireAuth, requirePermission("MANAGE_PRODUCTS"), async (req: Request, res: Response) => {
  try {
    const productsUser = await storage.getUser(req.userId!);
    if (!productsUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const products = await storage.getProductsByTenant(productsUser.tenantId);
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.post("/api/products", requireAuth, requirePermission("MANAGE_PRODUCTS"), async (req: Request, res: Response) => {
  try {
    const createProductUser = await storage.getUser(req.userId!);
    if (!createProductUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const productData = insertProductSchema.omit({ tenantId: true }).safeParse(req.body);
    if (!productData.success) {
      return res.status(400).json({ error: "Invalid product data", details: productData.error.issues });
    }
    
    const product = await storage.createProduct({
      tenantId: createProductUser.tenantId,
      ...productData.data,
    });
    res.status(201).json(product);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

router.patch("/api/products/:id", requireAuth, requirePermission("MANAGE_PRODUCTS"), async (req: Request, res: Response) => {
  try {
    const productUpdateUser = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!productUpdateUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existingProduct = await storage.getProduct(req.params.id);
    if (!existingProduct || existingProduct.tenantId !== productUpdateUser.tenantId) {
      return res.status(404).json({ error: "Product not found" });
    }
    const product = await storage.updateProduct(req.params.id, req.body);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

router.delete("/api/products/:id", requireAuth, requirePermission("MANAGE_PRODUCTS"), async (req: Request, res: Response) => {
  try {
    const productDeleteUser = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!productDeleteUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const product = await storage.getProduct(req.params.id);
    if (!product || product.tenantId !== productDeleteUser.tenantId) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    const deleted = await storage.deleteProduct(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    await storage.deleteRagBySource(product.tenantId, "PRODUCT", product.id);
    
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

router.post("/api/products/import", requireAuth, requirePermission("MANAGE_PRODUCTS"), async (req: Request, res: Response) => {
  try {
    const importProductsUser = await storage.getUser(req.userId!);
    if (!importProductsUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const products = req.body.products || [];
    let count = 0;
    
    for (const p of products) {
      await storage.createProduct({
        tenantId: importProductsUser.tenantId,
        name: p.name,
        sku: p.sku,
        description: p.description,
        price: parseFloat(p.price) || null,
        category: p.category,
        inStock: p.inStock !== "false" && p.inStock !== false,
        stockQuantity: parseInt(p.stockQuantity) || null,
      });
      count++;
    }
    
    res.json({ count, message: `Imported ${count} products` });
  } catch (error) {
    console.error("Error importing products:", error);
    res.status(500).json({ error: "Failed to import products" });
  }
});

export default router;
