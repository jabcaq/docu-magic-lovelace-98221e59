import { useState, useRef, useEffect } from "react";

interface MagnifyingGlassProps {
  imageUrl: string;
  onImageLoad?: () => void;
}

const MagnifyingGlass = ({ imageUrl, onImageLoad }: MagnifyingGlassProps) => {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const magnifierSize = 150;
  const zoomLevel = 2.5;

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((prev) => Math.max(0.5, Math.min(3, prev + delta)));
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });
    }

    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    setShowMagnifier(true);
  };

  const handleMouseLeave = () => {
    setShowMagnifier(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const imageRect = imageRef.current.getBoundingClientRect();

    // Position relative to container
    const x = e.clientX - containerRect.left;
    const y = e.clientY - containerRect.top;

    // Position relative to image
    const imgX = e.clientX - imageRect.left;
    const imgY = e.clientY - imageRect.top;

    setMagnifierPosition({ x, y });
    setImagePosition({ x: imgX, y: imgY });
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden bg-muted/30 rounded-lg cursor-crosshair"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      style={{ minHeight: "400px" }}
    >
      {/* Main Image */}
      <img
        ref={imageRef}
        src={imageUrl}
        alt="Document"
        className="w-full h-auto transition-transform duration-200 select-none"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "center",
        }}
        onLoad={onImageLoad}
        draggable={false}
      />

      {/* Magnifying Glass */}
      {showMagnifier && (
        <div
          className="absolute border-4 border-primary rounded-full pointer-events-none shadow-2xl bg-background"
          style={{
            width: `${magnifierSize}px`,
            height: `${magnifierSize}px`,
            left: `${magnifierPosition.x - magnifierSize / 2}px`,
            top: `${magnifierPosition.y - magnifierSize / 2}px`,
            backgroundImage: `url('${imageUrl}')`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${imageRef.current?.width ? imageRef.current.width * zoomLevel * zoom : 0}px ${
              imageRef.current?.height ? imageRef.current.height * zoomLevel * zoom : 0
            }px`,
            backgroundPosition: `-${imagePosition.x * zoomLevel * zoom - magnifierSize / 2}px -${
              imagePosition.y * zoomLevel * zoom - magnifierSize / 2
            }px`,
          }}
        />
      )}

      {/* Zoom Indicator */}
      <div className="absolute bottom-4 right-4 bg-card/80 backdrop-blur-sm px-3 py-1 rounded-lg text-sm font-medium border">
        Zoom: {Math.round(zoom * 100)}%
      </div>

      {/* Instructions */}
      <div className="absolute top-4 left-4 bg-card/80 backdrop-blur-sm px-3 py-1 rounded-lg text-xs text-muted-foreground border">
        Użyj scrolla aby powiększyć/pomniejszyć
      </div>
    </div>
  );
};

export default MagnifyingGlass;
