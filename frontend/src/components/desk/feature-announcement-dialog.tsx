import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, post } from "@/lib/api";

type ActiveAnnouncement = {
  id: string;
  title: string;
  body: string;
  imageUrls: string[];
  videoUrl: string | null;
  cta?: { label: string; url: string } | null;
};

/**
 * `onNavigate` takes an in-app path ("/subscribe") so the button can use the
 * client-side router; without it the button is a plain link. Client-side matters
 * here: a full page load would risk cancelling the dismiss request in flight.
 */
export function FeatureAnnouncementDialog({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [open, setOpen] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    api<{ announcement: ActiveAnnouncement | null }>("/api/announcements/active")
      .then((result) => {
        if (result.announcement) {
          setAnnouncement(result.announcement);
          setOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  const close = () => {
    setOpen(false);
    if (announcement && !dismissedRef.current) {
      dismissedRef.current = true;
      void post(`/api/announcements/${announcement.id}/dismiss`).catch(() => {});
    }
  };

  if (!announcement) return null;

  // In-app paths stay in this tab; the server only ever stores a "/path" or an https URL.
  const ctaExternal = announcement.cta ? !announcement.cta.url.startsWith("/") : false;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{announcement.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {announcement.body.split(/\n\s*\n/).map((paragraph, i) => (
            <p key={i} className="text-[14px] leading-relaxed">{paragraph}</p>
          ))}
          {announcement.imageUrls.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {announcement.imageUrls.map((url) => (
                <img key={url} src={url} alt="" role="img" className="rounded-lg border object-cover" />
              ))}
            </div>
          )}
          {announcement.videoUrl && (
            <iframe
              src={announcement.videoUrl}
              title="فيديو الميزة الجديدة"
              className="aspect-video w-full rounded-lg border"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
        {announcement.cta ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="sm:flex-1">
              <a
                href={announcement.cta.url}
                {...(ctaExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={(event) => {
                  close();
                  if (!ctaExternal && onNavigate) {
                    event.preventDefault();
                    onNavigate(announcement.cta!.url);
                  }
                }}
              >
                {announcement.cta.label}
              </a>
            </Button>
            <Button variant="outline" onClick={close}>
              تمام
            </Button>
          </div>
        ) : (
          <Button onClick={close}>تمام</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
