import React from "react";
import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";

interface MarkdownTextProps {
  content: string;
}

/** Render inline tokens (bold, italic, code, links, text) */
function renderInlineTokens(tokens: Token[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case "strong":
        nodes.push(
          <Text key={i} bold>
            {renderInlineTokens((token as Tokens.Strong).tokens)}
          </Text>
        );
        break;
      case "em":
        nodes.push(
          <Text key={i} italic>
            {renderInlineTokens((token as Tokens.Em).tokens)}
          </Text>
        );
        break;
      case "codespan":
        nodes.push(
          <Text key={i} color="yellow">
            {(token as Tokens.Codespan).text}
          </Text>
        );
        break;
      case "link": {
        const link = token as Tokens.Link;
        nodes.push(
          <Text key={i}>
            <Text color="cyan" underline>{link.text}</Text>
            <Text dimColor>{` (${link.href})`}</Text>
          </Text>
        );
        break;
      }
      case "del":
        nodes.push(
          <Text key={i} strikethrough dimColor>
            {renderInlineTokens((token as Tokens.Del).tokens)}
          </Text>
        );
        break;
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) {
          nodes.push(<React.Fragment key={i}>{renderInlineTokens(t.tokens)}</React.Fragment>);
        } else {
          nodes.push(t.text);
        }
        break;
      }
      case "escape":
        nodes.push((token as Tokens.Escape).text);
        break;
      case "br":
        nodes.push("\n");
        break;
      case "image": {
        const img = token as Tokens.Image;
        nodes.push(
          <Text key={i} dimColor>{`[image: ${img.text || img.href}]`}</Text>
        );
        break;
      }
      default:
        // Fallback: render raw text if available
        if ("text" in token) {
          nodes.push((token as any).text);
        } else if ("raw" in token) {
          nodes.push((token as any).raw);
        }
        break;
    }
  }
  return nodes;
}

/** Render a single block-level token */
function renderBlock(token: Token, key: number): React.ReactNode {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      return (
        <Text key={key} bold color="cyan">
          {renderInlineTokens(heading.tokens)}
        </Text>
      );
    }
    case "paragraph": {
      const para = token as Tokens.Paragraph;
      return (
        <Text key={key} wrap="wrap">
          {renderInlineTokens(para.tokens)}
        </Text>
      );
    }
    case "code": {
      const code = token as Tokens.Code;
      const lines = code.text.split("\n");
      return (
        <Box key={key} flexDirection="column" marginY={0}>
          {code.lang && (
            <Text dimColor>{`  ${code.lang}`}</Text>
          )}
          {lines.map((line, j) => (
            <Text key={j} color="gray">
              {`  | ${line}`}
            </Text>
          ))}
        </Box>
      );
    }
    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      return (
        <Box key={key} flexDirection="column">
          {bq.tokens.map((t, j) => (
            <Text key={j} italic dimColor>
              {"  | "}{renderInlineTokens("tokens" in t ? (t as any).tokens : [])}
            </Text>
          ))}
        </Box>
      );
    }
    case "list": {
      const list = token as Tokens.List;
      return (
        <Box key={key} flexDirection="column">
          {list.items.map((item, j) => {
            const prefix = list.ordered ? `  ${j + 1}. ` : "  - ";
            return (
              <Text key={j} wrap="wrap">
                {prefix}
                {renderInlineTokens(item.tokens.flatMap((t) =>
                  "tokens" in t ? (t as any).tokens : [t]
                ))}
              </Text>
            );
          })}
        </Box>
      );
    }
    case "hr":
      return (
        <Text key={key} dimColor>
          {"  " + "─".repeat(40)}
        </Text>
      );
    case "table": {
      const table = token as Tokens.Table;
      return (
        <Box key={key} flexDirection="column">
          <Text key="header" bold>
            {"  | "}{table.header.map((h) => h.text).join(" | ")}{" |"}
          </Text>
          <Text key="sep" dimColor>
            {"  |"}{table.header.map(() => "-------").join("|")}{"|"}
          </Text>
          {table.rows.map((row, j) => (
            <Text key={j}>
              {"  | "}{row.map((cell) => cell.text).join(" | ")}{" |"}
            </Text>
          ))}
        </Box>
      );
    }
    case "html": {
      const html = token as Tokens.HTML;
      return (
        <Text key={key} dimColor>{html.text.trim()}</Text>
      );
    }
    case "space":
      return <Text key={key}>{" "}</Text>;
    default:
      if ("raw" in token) {
        return <Text key={key}>{(token as any).raw}</Text>;
      }
      return null;
  }
}

export function MarkdownText({ content }: MarkdownTextProps) {
  if (!content.trim()) {
    return null;
  }

  let tokens: Token[];
  try {
    tokens = marked.lexer(content);
  } catch {
    return (
      <Box flexDirection="column">
        <Text wrap="wrap">{content}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {tokens.map((token, i) => renderBlock(token, i))}
    </Box>
  );
}
