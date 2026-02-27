# **App Name**: BidBrain Analyzer

## Core Features:

- CSV Data Ingestion: Allows users to upload a CSV file containing multi-day, time-bucket-level bidding data for multiple catalogs. Includes validation for required columns and data structure.
- Analysis Type Selector: Provides a user interface to select between 'Low BU Analysis' and 'Low Delivery Analysis' to guide the diagnostic process.
- AI-Powered Catalog Diagnosis Tool: Processes uploaded data by grouping it per unique catalog_id and then, for each catalog, makes a targeted LLM call to diagnose the root cause of bidding performance issues based on the selected analysis type.
- Ephemeral Result Storage: Stores the structured JSON output from the LLM locally in session memory for immediate use, without requiring a persistent database.
- Interactive Diagnostic Results Display: Presents a clear table view summarizing diagnostic findings per catalog (catalog_id, issue_type, root_cause, severity) with expandable sections for detailed explanations and recommendations.
- Results Export: Enables users to export the full structured diagnostic results, including detailed explanations, as a CSV file.

## Style Guidelines:

- Primary color: A thoughtful, clear blue (HSL(200, 60%, 40%) / #2989CC) for key interactive elements, headings, and branding, reflecting precision and insight.
- Background color: A subtly tinged, very light sky blue (HSL(200, 20%, 95%) / #E8F3FA), providing a clean and professional canvas that promotes readability.
- Accent color: A vibrant, deep purple-blue (HSL(230, 70%, 55%) / #525FDE) used sparingly for critical actions, highlights, and status indicators, signifying importance and dynamism without being intrusive.
- All text will use 'Inter' (sans-serif), chosen for its neutral, objective, and highly legible characteristics, ensuring clarity across data tables and diagnostic explanations.
- Utilize professional, clean line-art icons that communicate actions and status clearly, consistent with the diagnostic and analytical nature of the tool.
- The layout prioritizes a clear, data-centric presentation, featuring organized tables, expandable content areas, and intuitive navigation for efficient diagnostic review. Use of white space will ensure content is easily digestible.
- Implement subtle animations for loading states during LLM processing and smooth transitions for expanding detailed diagnostic information, enhancing user feedback and experience without distraction.