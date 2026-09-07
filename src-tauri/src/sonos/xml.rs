//! Small helpers over roxmltree. Sonos XML is namespaced inconsistently, so we
//! match on local names only.

use roxmltree::{Document, Node};

/// Text of the first descendant with this local name.
pub fn descendant_text(node: Node, name: &str) -> Option<String> {
    node.descendants()
        .find(|n| n.is_element() && n.tag_name().name() == name)
        .and_then(|n| n.text())
        .map(|s| s.to_string())
}

/// First descendant element with this local name.
pub fn descendant<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    node.descendants().find(|n| n.is_element() && n.tag_name().name() == name)
}

/// Direct child text.
pub fn child_text(node: Node, name: &str) -> Option<String> {
    node.children()
        .find(|n| n.is_element() && n.tag_name().name() == name)
        .and_then(|n| n.text())
        .map(|s| s.to_string())
}

pub fn attr(node: Node, name: &str) -> Option<String> {
    node.attribute(name).map(|s| s.to_string())
}

/// Escape text for inclusion in an XML element body / attribute.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Parse a document, tolerating a leading BOM / whitespace.
pub fn parse(xml: &str) -> Result<Document<'_>, roxmltree::Error> {
    let trimmed = xml.trim_start_matches('\u{feff}').trim_start();
    Document::parse(trimmed)
}

/// Non-empty text or None.
pub fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.trim().is_empty())
}
