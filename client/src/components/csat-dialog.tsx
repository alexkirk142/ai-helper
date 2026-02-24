import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CsatDialogProps {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CsatDialog({ conversationId, open, onOpenChange }: CsatDialogProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState("");
  const { toast } = useToast();

  const { data: csatStatus } = useQuery<{ submitted: boolean; rating: number | null }>({
    queryKey: ["/api/conversations", conversationId, "csat"],
    enabled: !!conversationId && open,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/conversations/${conversationId}/csat`, {
        rating,
        comment: comment || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Спасибо за оценку!" });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "csat"] });
      onOpenChange(false);
      setRating(0);
      setComment("");
    },
    onError: () => {
      toast({ title: "Не удалось отправить оценку", variant: "destructive" });
    },
  });

  if (csatStatus?.submitted) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Оценка уже отправлена</DialogTitle>
            <DialogDescription>
              Вы уже оценили этот диалог на {csatStatus.rating} из 5
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} data-testid="button-csat-close">
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Оцените качество обслуживания</DialogTitle>
          <DialogDescription>
            Насколько клиент остался доволен решением вопроса?
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-2 py-4">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className="p-1 transition-transform hover:scale-110"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              data-testid={`button-csat-star-${star}`}
            >
              <Star
                className={`h-8 w-8 ${
                  star <= (hoveredRating || rating)
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground"
                }`}
              />
            </button>
          ))}
        </div>

        <div className="text-center text-sm text-muted-foreground">
          {rating === 1 && "Очень плохо"}
          {rating === 2 && "Плохо"}
          {rating === 3 && "Нормально"}
          {rating === 4 && "Хорошо"}
          {rating === 5 && "Отлично"}
        </div>

        <Textarea
          placeholder="Комментарий (необязательно)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="mt-4"
          data-testid="input-csat-comment"
        />

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-csat-cancel"
          >
            Отмена
          </Button>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={rating === 0 || submitMutation.isPending}
            data-testid="button-csat-submit"
          >
            Отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
