import React from "react";
import { Box, Text } from "ink";

interface MarkdownTextProps {
  content: string;
}

function renderInline(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Combined regex for inline patterns: `code`, **bold**, *italic*, [text](url)
  const pattern = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      // inline code
      nodes.push(
        <Text key={key++} color="yellow">
          {match[1]}
        </Text>
      );
    } else if (match[2] !== undefined) {
      // bold
      nodes.push(
        <Text key={key++} bold>
          {match[2]}
        </Text>
      );
    } else if (match[3] !== undefined) {
      // italic
      nodes.push(
        <Text key={key++} italic>
          {match[3]}
        </Text>
      );
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // link
      nodes.push(
        <Text key={key++}>
          <Text color="cyan" underline>
            {match[4]}
          </Text>
          <Text dimColor>{` (${match[5]})`}</Text>
        </Text>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <Box key={elements.length} flexDirection="column" marginY={0}>
          {lang && (
            <Text dimColor>{`  ${lang}`}</Text>
          )}
          {codeLines.map((cl, j) => (
            <Text key={j} color="gray">
              {`  | ${cl}`}
            </Text>
          ))}
        </Box>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <Text key={elements.length} dimColor>
          {"  " + "─".repeat(40)}
        </Text>
      );
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      elements.push(
        <Text key={elements.length} bold color="cyan">
          {headingMatch[2]}
        </Text>
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const quoteText = line.trimStart().slice(2);
      elements.push(
        <Text key={elements.length} italic>
          {`  | ${quoteText}`}
        </Text>
      );
      i++;
      continue;
    }

    // Bullet list
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (bulletMatch) {
      const indent = "  " + " ".repeat(bulletMatch[1]!.length);
      elements.push(
        <Text key={elements.length} wrap="wrap">
          {indent + "- "}
          {renderInline(bulletMatch[2]!)}
        </Text>
      );
      i++;
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (numMatch) {
      const indent = "  " + " ".repeat(numMatch[1]!.length);
      const num = line.match(/^(\s*)(\d+)\./);
      elements.push(
        <Text key={elements.length} wrap="wrap">
          {indent + (num?.[2] ?? "1") + ". "}
          {renderInline(numMatch[2]!)}
        </Text>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<Text key={elements.length}>{" "}</Text>);
      i++;
      continue;
    }

    // Regular paragraph with inline formatting
    elements.push(
      <Text key={elements.length} wrap="wrap">
        {renderInline(line)}
      </Text>
    );
    i++;
  }

  return (
    <Box flexDirection="column">
      {elements}
    </Box>
  );
}
