import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle,
  X,
  MessageSquare,
  Clock,
  User,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { EscalationEvent } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";

const reasonLabels: Record<string, { label: string; color: string }> = {
  "no_data": { label: "Нет данных", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  "discount_request": { label: "Запрос скидки", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  "complaint": { label: "Жалоба", color: "bg-red-500/10 text-red-600 dark:text-red-400" },
  "legal": { label: "Юридический вопрос", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  "payment": { label: "Проблема с оплатой", color: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  "human_requested": { label: "Запрос человека", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  "low_confidence": { label: "Низкая уверенность", color: "bg-gray-500/10 text-gray-600 dark:text-gray-400" },
};

export default function Escalations() {
  const [selectedEscalation, setSelectedEscalation] = useState<EscalationEvent | null>(null);
  const [response, setResponse] = useState("");
  const { toast } = useToast();

  const { data: escalations, isLoading } = useQuery<EscalationEvent[]>({
    queryKey: ["/api/escalations"],
  });

  const handleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/escalations/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/escalations"] });
      setSelectedEscalation(null);
      toast({ title: "Эскалация обновлена" });
    },
    onError: () => {
      toast({ title: "Не удалось обновить эскалацию", variant: "destructive" });
    },
  });

  const pendingEscalations = escalations?.filter((e) => e.status === "pending") || [];
  const handledEscalations = escalations?.filter((e) => e.status !== "pending") || [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Эскалации</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обработка разговоров, требующих внимания человека
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <div className="text-2xl font-bold">{pendingEscalations.length}</div>
              <div className="text-sm text-muted-foreground">Ожидают</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-online/10">
              <CheckCircle className="h-6 w-6 text-status-online" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {handledEscalations.filter((e) => e.status === "handled").length}
              </div>
              <div className="text-sm text-muted-foreground">Обработано</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <X className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {handledEscalations.filter((e) => e.status === "dismissed").length}
              </div>
              <div className="text-sm text-muted-foreground">Отклонено</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Escalations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Ожидающие эскалации ({pendingEscalations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-md border p-4">
                    <div className="flex items-start gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingEscalations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle className="h-16 w-16 text-status-online opacity-50" />
                <p className="mt-4 text-lg font-medium">Все обработано!</p>
                <p className="text-sm text-muted-foreground">
                  Нет ожидающих эскалаций
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingEscalations.map((escalation) => (
                  <div
                    key={escalation.id}
                    className="rounded-md border p-4 hover-elevate cursor-pointer"
                    onClick={() => setSelectedEscalation(escalation)}
                    data-testid={`escalation-pending-${escalation.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{escalation.reason}</span>
                            {reasonLabels[escalation.reason] && (
                              <Badge
                                variant="secondary"
                                className={reasonLabels[escalation.reason].color}
                              >
                                {reasonLabels[escalation.reason].label}
                              </Badge>
                            )}
                          </div>
                          {escalation.summary && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {escalation.summary}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(escalation.createdAt), {
                                addSuffix: true,
                                locale: ru,
                              })}
                            </span>
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              Посмотреть разговор
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMutation.mutate({ id: escalation.id, status: "dismissed" });
                          }}
                          data-testid={`escalation-dismiss-${escalation.id}`}
                        >
                          Отклонить
                        </Button>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMutation.mutate({ id: escalation.id, status: "handled" });
                          }}
                          data-testid={`escalation-handle-${escalation.id}`}
                        >
                          Обработано
                        </Button>
                      </div>
                    </div>
                    {escalation.suggestedResponse && (
                      <div className="mt-4 rounded-md bg-muted p-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          Предложенный AI ответ:
                        </div>
                        <p className="mt-1 text-sm">{escalation.suggestedResponse}</p>
                      </div>
                    )}
                    {escalation.clarificationNeeded && (
                      <div className="mt-2 rounded-md bg-orange-500/10 p-3">
                        <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                          Требуется уточнение:
                        </div>
                        <p className="mt-1 text-sm">{escalation.clarificationNeeded}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Recent Handled */}
      {handledEscalations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Недавно обработанные</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <div className="space-y-3">
                {handledEscalations.slice(0, 10).map((escalation) => (
                  <div
                    key={escalation.id}
                    className="flex items-center justify-between rounded-md border p-3"
                    data-testid={`escalation-handled-${escalation.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          escalation.status === "handled"
                            ? "bg-status-online/10"
                            : "bg-muted"
                        }`}
                      >
                        {escalation.status === "handled" ? (
                          <CheckCircle className="h-4 w-4 text-status-online" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{escalation.reason}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(escalation.createdAt), {
                            addSuffix: true,
                            locale: ru,
                          })}
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {escalation.status === "handled" ? "Обработано" : "Отклонено"}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Escalation Detail Dialog */}
      <Dialog
        open={!!selectedEscalation}
        onOpenChange={() => setSelectedEscalation(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Детали эскалации
            </DialogTitle>
          </DialogHeader>
          {selectedEscalation && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">{selectedEscalation.reason}</Badge>
                <Badge variant="outline">
                  {selectedEscalation.status === "pending" ? "Ожидает" : 
                   selectedEscalation.status === "handled" ? "Обработано" : "Отклонено"}
                </Badge>
              </div>
              {selectedEscalation.summary && (
                <div>
                  <div className="text-sm font-medium">Описание</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedEscalation.summary}
                  </p>
                </div>
              )}
              {selectedEscalation.suggestedResponse && (
                <div>
                  <div className="text-sm font-medium">Предложенный AI ответ</div>
                  <div className="mt-1 rounded-md bg-muted p-3 text-sm">
                    {selectedEscalation.suggestedResponse}
                  </div>
                </div>
              )}
              {selectedEscalation.clarificationNeeded && (
                <div>
                  <div className="text-sm font-medium">Требуется уточнение</div>
                  <div className="mt-1 rounded-md bg-orange-500/10 p-3 text-sm">
                    {selectedEscalation.clarificationNeeded}
                  </div>
                </div>
              )}
              <div>
                <div className="text-sm font-medium">Ваш ответ</div>
                <Textarea
                  placeholder="Введите ответ клиенту..."
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  className="mt-1"
                  data-testid="textarea-escalation-response"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    handleMutation.mutate({
                      id: selectedEscalation.id,
                      status: "dismissed",
                    });
                  }}
                >
                  Отклонить
                </Button>
                <Button
                  onClick={() => {
                    handleMutation.mutate({
                      id: selectedEscalation.id,
                      status: "handled",
                    });
                  }}
                >
                  Отметить как обработано
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
