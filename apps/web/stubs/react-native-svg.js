/**
 * react-native-svg Web Stub
 * 将 react-native-svg 的组件映射为标准 HTML SVG 元素。
 * Next.js Web 端不需要原生 SVG 模块，直接使用浏览器内置 SVG 即可。
 */
"use client";

import React from "react";

// Svg 根容器 → <svg>
function Svg(props) {
  const { children, width, height, viewBox, fill, stroke, strokeWidth, strokeLinecap, strokeLinejoin, style, ...rest } = props;
  return React.createElement("svg", {
    width, height, viewBox, fill, stroke, strokeWidth, strokeLinecap, strokeLinejoin, style,
    xmlns: "http://www.w3.org/2000/svg",
    ...rest,
  }, children);
}

// 各 SVG 子元素直接透传为对应的 HTML SVG 标签
function Path(props) { return React.createElement("path", props); }
function Circle(props) { return React.createElement("circle", props); }
function Rect(props) { return React.createElement("rect", props); }
function Line(props) { return React.createElement("line", props); }
function Polyline(props) { return React.createElement("polyline", props); }
function Polygon(props) { return React.createElement("polygon", props); }
function Text(props) { return React.createElement("text", props); }
function G(props) { return React.createElement("g", props); }
function Defs(props) { return React.createElement("defs", props); }
function ClipPath(props) { return React.createElement("clipPath", props); }
function LinearGradient(props) { return React.createElement("linearGradient", props); }
function RadialGradient(props) { return React.createElement("radialGradient", props); }
function Stop(props) { return React.createElement("stop", props); }
function Ellipse(props) { return React.createElement("ellipse", props); }
function TSpan(props) { return React.createElement("tspan", props); }
function Use(props) { return React.createElement("use", props); }
function Symbol(props) { return React.createElement("symbol", props); }
function Mask(props) { return React.createElement("mask", props); }
function Image(props) { return React.createElement("image", props); }

export default Svg;
export {
  Svg, Path, Circle, Rect, Line, Polyline, Polygon, Text, G,
  Defs, ClipPath, LinearGradient, RadialGradient, Stop, Ellipse,
  TSpan, Use, Symbol, Mask, Image,
};
