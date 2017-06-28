# OCRUD


## About
Work in progress!

An "object"-based CRUD app that leverages a variety of JSON tools:

- Postgres' great support for JSON as a native type, with general indexing to store the objects
- jdorn's JSON editor to provide a rich editor for the objects
- Server-side validation via the same json schema that enabled the editor

Roadmap:
- Authentication (probably via JWT)
- Querying based on postgres GIN operators
- Building static files from JSON based on a templating language
- Alternate editor UIs

## Install

- Requires a postgres database
- npm install
- cp config.example.hanson config.hanson
- Edit config.hanson with:
  - database info
  - Webserver port
  - Entity definitions (mostly their JSON schema)
