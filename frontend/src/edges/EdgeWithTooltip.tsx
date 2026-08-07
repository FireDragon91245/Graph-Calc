import { EdgeLabelRenderer, EdgeProps, getBezierPath } from "reactflow";
import { useMemo, useState } from "react";
import type { EdgeFlowData } from "../api/solve";
import { useGraphStore } from "../store/graphStore";

type EdgeData = EdgeFlowData & {
  isProblem?: boolean;
};

export default function EdgeWithTooltip({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}: EdgeProps<EdgeData>) {
  const [isHovered, setIsHovered] = useState(false);
  const items = useGraphStore((state) => state.items);
  const itemNameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const hasFlowData = data && data.totalFlow > 0;
  const isProblem = data?.isProblem === true;

  // Determine stroke color based on state
  let strokeColor = "#b1b1b7"; // default
  if (selected) {
    strokeColor = "#3b82f6"; // blue when selected
  } else if (isProblem) {
    strokeColor = "#ef4444"; // red for problem edges
  } else if (hasFlowData) {
    strokeColor = "#10b981"; // green when has flow data
  } else if (style.stroke) {
    strokeColor = style.stroke;
  }

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      <path
        id={id}
        style={{
          ...style,
          strokeWidth: isProblem ? 2.5 : hasFlowData ? 2 : 1,
          stroke: strokeColor,
          pointerEvents: "none",
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      {isProblem && !hasFlowData && (
        <EdgeLabelRenderer>
          <div
            className="edge-flow-label"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 11,
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            <div
              className="edge-flow-badge"
              style={{
                background: "rgba(16, 20, 28, 0.95)",
                padding: "4px 8px",
                borderRadius: "6px",
                color: "#ef4444",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                whiteSpace: "nowrap",
              }}
            >
              No flow
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
      {hasFlowData && (
        <>
          <EdgeLabelRenderer>
            <div
              className="edge-flow-label"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                fontSize: 11,
                fontWeight: 600,
                pointerEvents: "none",
              }}
            >
              <div
                className="edge-flow-badge"
                style={{
                  background: "rgba(16, 20, 28, 0.95)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  whiteSpace: "nowrap",
                }}
              >
                {data.totalFlow.toFixed(2)}/s
              </div>
            </div>
          </EdgeLabelRenderer>

          {isHovered && Object.keys(data.flows).length > 0 && (
            <EdgeLabelRenderer>
              <div
                className="edge-flow-tooltip"
                style={{
                  position: "absolute",
                  transform: `translate(-50%, 20px) translate(${labelX}px,${labelY}px)`,
                  background: "rgba(16, 20, 28, 0.98)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  minWidth: "180px",
                  width: "max-content",
                  pointerEvents: "none",
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#9ca3af",
                    marginBottom: "6px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Flow Details
                </div>
                {Object.entries(data.flows).map(([itemId, rate]) => (
                  <div
                    key={itemId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "4px 0",
                      fontSize: "12px",
                      gap: "16px",
                    }}
                  >
                    <span style={{ color: "#e5e7eb", whiteSpace: "nowrap" }}>
                      {itemNameById.get(itemId) ?? itemId}
                    </span>
                    <span
                      style={{
                        color: "#10b981",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {rate.toFixed(2)}/s
                    </span>
                  </div>
                ))}
              </div>
            </EdgeLabelRenderer>
          )}
        </>
      )}
    </>
  );
}
