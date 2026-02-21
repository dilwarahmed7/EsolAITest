# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy everything in /backend into the build container
COPY . .

# Restore and publish
RUN dotnet restore ./backend.csproj
RUN dotnet publish ./backend.csproj -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .

# Render provides PORT; ASP.NET must bind to it
ENV ASPNETCORE_URLS=http://0.0.0.0:${PORT}

# Start the API
ENTRYPOINT ["dotnet", "backend.dll"]
