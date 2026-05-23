import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Search,
  Package,
  Edit2,
  Trash2,
  MoreHorizontal,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import type { Product } from "@shared/schema";

const productFormSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  sku: z.string().optional(),
  description: z.string().optional(),
  price: z.coerce.number().min(0, "Цена должна быть положительной").optional(),
  category: z.string().optional(),
  inStock: z.boolean().default(true),
  stockQuantity: z.coerce.number().min(0).optional(),
  deliveryInfo: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

export default function Products() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "",
      sku: "",
      description: "",
      price: 0,
      category: "",
      inStock: true,
      stockQuantity: 0,
      deliveryInfo: "",
    },
  });

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProductFormValues) => {
      return apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Товар создан" });
    },
    onError: () => {
      toast({ title: "Не удалось создать товар", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ProductFormValues }) => {
      return apiRequest("PATCH", `/api/products/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsDialogOpen(false);
      setEditingProduct(null);
      form.reset();
      toast({ title: "Товар обновлен" });
    },
    onError: () => {
      toast({ title: "Не удалось обновить товар", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Товар удален" });
    },
    onError: () => {
      toast({ title: "Не удалось удалить товар", variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsImportDialogOpen(false);
      toast({ title: `Импортировано ${data.count} товаров` });
    },
    onError: () => {
      toast({ title: "Не удалось импортировать товары", variant: "destructive" });
    },
  });

  const handleOpenCreate = () => {
    setEditingProduct(null);
    form.reset({
      name: "",
      sku: "",
      description: "",
      price: 0,
      category: "",
      inStock: true,
      stockQuantity: 0,
      deliveryInfo: "",
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      name: product.name,
      sku: product.sku || "",
      description: product.description || "",
      price: product.price || 0,
      category: product.category || "",
      inStock: product.inStock ?? true,
      stockQuantity: product.stockQuantity || 0,
      deliveryInfo: product.deliveryInfo || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (data: ProductFormValues) => {
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      importMutation.mutate(formData);
    }
  };

  const filteredProducts = products?.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 p-4 sm:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs text-primary font-semibold tracking-wider uppercase">
            База данных
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Товары</h1>
          <p className="text-sm text-muted-foreground font-medium">
            Управление каталогом товаров для генерации точных ответов AI-агента.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-products" className="rounded-xl font-semibold hover:bg-card/80 border-border/40">
                <Upload className="mr-2 h-4 w-4 text-primary" />
                Импорт CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle>Импорт товаров из CSV</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Загрузите CSV-файл с колонками: name, sku, description, price, category, inStock, stockQuantity
                </p>
                <div
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/60 p-8 cursor-pointer hover:bg-muted/25 transition-all"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-csv"
                >
                  <FileSpreadsheet className="h-12 w-12 text-primary/85" />
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    Нажмите для загрузки или перетащите файл
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Поддерживаются только .csv файлы</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileUpload}
                    data-testid="input-csv-file"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsImportDialogOpen(false)} className="rounded-xl">
                  Отмена
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate} data-testid="button-add-product" className="rounded-xl font-semibold shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-4 w-4" />
                Добавить товар
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl rounded-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingProduct ? "Редактировать товар" : "Добавить товар"}
                </DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Название</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Название товара"
                              {...field}
                              className="rounded-xl"
                              data-testid="input-product-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Артикул</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="SKU-001"
                              {...field}
                              className="rounded-xl"
                              data-testid="input-product-sku"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Описание</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Описание товара..."
                            {...field}
                            className="rounded-xl min-h-[100px]"
                            data-testid="textarea-product-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Цена</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              {...field}
                              className="rounded-xl"
                              data-testid="input-product-price"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Категория</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Категория"
                              {...field}
                              className="rounded-xl"
                              data-testid="input-product-category"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="stockQuantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Количество на складе</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              {...field}
                              className="rounded-xl"
                              data-testid="input-product-stock"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="inStock"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-xl border p-4">
                        <div>
                          <FormLabel>В наличии</FormLabel>
                          <FormDescription>
                            Доступен ли товар для покупки?
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-product-instock"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="deliveryInfo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Информация о доставке</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Сроки доставки, способы..."
                            {...field}
                            className="rounded-xl"
                            data-testid="textarea-product-delivery"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsDialogOpen(false)}
                      className="rounded-xl"
                    >
                      Отмена
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      className="rounded-xl font-bold"
                      data-testid="button-save-product"
                    >
                      {editingProduct ? "Обновить" : "Создать"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search */}
      <Card className="rounded-2xl border border-card-border bg-card shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground/80" />
            <Input
              placeholder="Поиск товаров по названию, артикулу или категории..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 rounded-xl bg-background/50 border-border/40 focus-visible:bg-background transition-all"
              data-testid="input-search-products"
            />
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card className="rounded-2xl border border-card-border bg-card shadow-sm overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-4">
          <CardTitle className="text-lg font-bold tracking-tight flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/10">
              <Package className="h-4.5 w-4.5" />
            </div>
            Все товары ({filteredProducts?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[550px]">
            <div className="overflow-x-auto">
            {isLoading ? (
              <div className="space-y-4 p-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48 rounded-full" />
                      <Skeleton className="h-3 w-24 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProducts?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3.5">
                  <Package className="h-6 w-6" />
                </div>
                <h3 className="font-bold text-sm">Каталог пуст</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
                  Добавьте товары, чтобы AI-агент мог использовать информацию о ценах и наличии при ответах.
                </p>
                <Button
                  variant="outline"
                  className="mt-4 rounded-xl font-semibold border-border/40 hover:bg-card/80"
                  onClick={handleOpenCreate}
                >
                  Добавить первый товар
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="py-4.5 font-bold text-foreground">Товар</TableHead>
                    <TableHead className="py-4.5 font-bold text-foreground">Артикул</TableHead>
                    <TableHead className="py-4.5 font-bold text-foreground">Категория</TableHead>
                    <TableHead className="py-4.5 font-bold text-foreground">Цена</TableHead>
                    <TableHead className="py-4.5 font-bold text-foreground">Наличие</TableHead>
                    <TableHead className="py-4.5 w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts?.map((product) => (
                    <TableRow key={product.id} className="hover:bg-muted/20 border-b border-border/30 last:border-0" data-testid={`product-row-${product.id}`}>
                      <TableCell className="py-4">
                        <div className="space-y-1">
                          <div className="font-bold text-sm text-foreground">{product.name}</div>
                          {product.description && (
                            <div className="max-w-[280px] truncate text-xs text-muted-foreground font-medium">
                              {product.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold py-4 text-muted-foreground">
                        {product.sku || "—"}
                      </TableCell>
                      <TableCell className="py-4">
                        {product.category ? (
                          <Badge variant="secondary" className="rounded-lg font-bold text-[10px] px-2.5 py-0.5 bg-primary/5 text-primary border border-primary/5">
                            {product.category}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="font-bold text-sm text-foreground py-4">
                        {product.price != null
                          ? `${product.price.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ${product.currency || "RUB"}`
                          : "—"}
                      </TableCell>
                      <TableCell className="py-4">
                        <Badge
                          variant={product.inStock ? "default" : "secondary"}
                          className={cn(
                            "rounded-full font-extrabold text-[10px] px-2.5 py-0.5",
                            product.inStock
                              ? "bg-success/15 text-success border border-success/20 hover:bg-success/15"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {product.inStock
                            ? product.stockQuantity
                              ? `${product.stockQuantity} шт.`
                              : "В наличии"
                            : "Нет в наличии"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg hover:bg-muted"
                              data-testid={`product-menu-${product.id}`}
                            >
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl">
                            <DropdownMenuItem
                              onClick={() => handleOpenEdit(product)}
                              data-testid={`product-edit-${product.id}`}
                              className="font-medium"
                            >
                              <Edit2 className="mr-2 h-4 w-4" />
                              Редактировать
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive font-semibold"
                              onClick={() => deleteMutation.mutate(product.id)}
                              data-testid={`product-delete-${product.id}`}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Удалить
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
