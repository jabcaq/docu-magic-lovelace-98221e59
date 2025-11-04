import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DocumentRun {
  id: string;
  text: string;
  tag: string | null;
  type: string;
}

interface DocumentPreviewProps {
  runs: DocumentRun[];
}

const DocumentPreview = ({ runs }: DocumentPreviewProps) => {
  const getRunStyle = (run: DocumentRun) => {
    if (run.tag) {
      return "bg-yellow-100 dark:bg-yellow-900/30 border-2 border-yellow-400 dark:border-yellow-600 px-2 py-1 rounded inline-block";
    }
    return "";
  };

  const getTagBadgeColor = (tag: string) => {
    // Generate consistent color based on tag name
    const hash = tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = [
      "bg-blue-100 text-blue-800 border-blue-300",
      "bg-green-100 text-green-800 border-green-300",
      "bg-purple-100 text-purple-800 border-purple-300",
      "bg-pink-100 text-pink-800 border-pink-300",
      "bg-orange-100 text-orange-800 border-orange-300",
    ];
    return colors[hash % colors.length];
  };

  return (
    <ScrollArea className="h-[600px] w-full border rounded-lg p-6 bg-white dark:bg-gray-900">
      <div className="space-y-4 font-serif text-base leading-relaxed">
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Podgląd dokumentu:</strong> Żółte pola to zmienne, które będą podstawione.
            Każda zmienna ma przypisany tag widoczny w formularzu po prawej stronie.
          </p>
        </div>

        {runs.map((run, index) => {
          const isNewParagraph = index === 0 || runs[index - 1]?.type === 'paragraph_break';
          
          return (
            <span key={run.id} className={isNewParagraph ? "block mt-4" : ""}>
              {run.tag ? (
                <span className="inline-block my-1">
                  <span className={getRunStyle(run)}>
                    <span className="font-medium">{run.text}</span>
                    <Badge 
                      variant="outline" 
                      className={`ml-2 text-xs font-mono ${getTagBadgeColor(run.tag)}`}
                    >
                      {run.tag.split(',').map(t => `{{${t.trim()}}}`).join(', ')}
                    </Badge>
                  </span>
                </span>
              ) : (
                <span>{run.text}</span>
              )}
              {' '}
            </span>
          );
        })}
      </div>
    </ScrollArea>
  );
};

export default DocumentPreview;
