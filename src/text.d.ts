// Type declarations for text file imports with { type: "text" }
declare module "*.md" {
  const content: string
  export default content
}

declare module "*.txt" {
  const content: string
  export default content
}
