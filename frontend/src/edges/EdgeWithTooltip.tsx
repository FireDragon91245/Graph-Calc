import { EdgeLabelRenderer, EdgeProps, getBezierPath } from "reactflow";
import { useState } from "react";
import type { EdgeFlowData } from "../api/solve";

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
}: EdgeProps<EdgeFlowData>) {
  const [isHovered, setIsHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const hasFlowData = data && data.totalFlow > 0;

  // Determine stroke color based on state
  let strokeColor = "#b1b1b7"; // default
  if (selected) {
    strokeColor = "#3b82f6"; // blue when selected
  } else if (hasFlowData) {
    strokeColor = "#10b981"; // green when has flow data
  } else if (style.stroke) {
    strokeColor = style.stroke;
  }

  return (
    <>
      <path
        id={id}
        style={{
          ...style,
          strokeWidth: hasFlowData ? 2 : 1,
          stroke: strokeColor,
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      {hasFlowData && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 11,
              fontWeight: 600,
              pointerEvents: "none",
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* Main label */}
            <div
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

            {/* Tooltip on hover */}
            {isHovered && Object.keys(data.flows).length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  marginTop: "8px",
                  background: "rgba(16, 20, 28, 0.98)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  minWidth: "150px",
                  zIndex: 1000,
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
                    <span style={{ color: "#e5e7eb" }}>{itemId}</span>
                    <span style={{ color: "#10b981", fontWeight: 600 }}>
                      {rate.toFixed(2)}/s
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
