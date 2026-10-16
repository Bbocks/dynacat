package dynacat

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"time"
)

var tracearrWidgetTemplate = mustParseTemplate("tracearr.html", "widget-base.html")

type tracearrSession struct {
	ID            string `json:"id"`
	MediaTitle    string `json:"media_title"`
	MediaType     string `json:"media_type"`
	ShowTitle     string `json:"show_title"`
	SeasonNumber  int    `json:"season_number"`
	EpisodeNumber int    `json:"episode_number"`
	Username      string `json:"username"`
	DurationMs    int64  `json:"duration_ms"`
	ProgressMs    int64  `json:"progress_ms"`
	State         string `json:"state"`
	VideoDecision string `json:"video_decision"`
	AudioDecision string `json:"audio_decision"`

	// Precomputed display values. Native widget templates only get dynacat's
	// globalTemplateFunctions, which has no mul/div/formatDuration, so all
	// formatting has to happen here in Go.
	FormattedProgress string `json:"-"`
	FormattedDuration string `json:"-"`
}

type tracearrSummary struct {
	Total        int    `json:"total"`
	Transcodes   int    `json:"transcodes"`
	DirectPlays  int    `json:"direct_plays"`
	TotalBitrate string `json:"total_bitrate"`
}

type tracearrAPIResponse struct {
	Data    []tracearrSession `json:"data"`
	Summary tracearrSummary   `json:"summary"`
}

type tracearrWidget struct {
	widgetBase `yaml:",inline"`
	Frameless  bool   `yaml:"frameless"`
	URL        string `yaml:"url"`
	Key        string `yaml:"key"`

	// AllowInsecure skips TLS certificate verification, for Tracearr instances
	// served behind self-signed certificates.
	AllowInsecure bool `yaml:"allow-insecure"`

	// Filled in on every update; never serialized back into the config.
	Sessions []tracearrSession `json:"-" yaml:"-"`
	Summary  tracearrSummary   `json:"-" yaml:"-"`
}

func (widget *tracearrWidget) initialize() error {
	widget.withTitle("Tracearr").withCacheDuration(30 * time.Second)

	if widget.URL == "" {
		return errors.New("url is required for tracearr widget")
	}

	if widget.Key == "" {
		return errors.New("key (API key) is required for tracearr widget")
	}

	if widget.UpdateInterval == nil {
		interval := updateIntervalField(30 * time.Second)
		widget.UpdateInterval = &interval
	}

	return nil
}

func (widget *tracearrWidget) setProviders(providers *widgetProviders) {
	widget.widgetBase.setProviders(providers)
}

// formatTracearrDuration renders a millisecond timestamp as m:ss or h:mm:ss.
func formatTracearrDuration(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	seconds := ms / 1000
	if seconds >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", seconds/3600, (seconds/60)%60, seconds%60)
	}
	return fmt.Sprintf("%d:%02d", seconds/60, seconds%60)
}

func (widget *tracearrWidget) update(ctx context.Context) {
	if widget.Providers == nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, widget.URL+"/api/v2/public/streams", nil)
	if err != nil {
		widget.withError(err)
		return
	}

	req.Header.Set("Authorization", "Bearer "+widget.Key)
	req.Header.Set("Accept", "application/json")

	client := ternary(widget.AllowInsecure, defaultInsecureHTTPClient, defaultHTTPClient)

	// decodeJsonFromRequest shares identical GET requests across widgets,
	// checks the status code, and decodes the JSON body.
	apiResponse, err := decodeJsonFromRequest[tracearrAPIResponse](client, req)
	if err != nil {
		widget.withError(err)
		return
	}

	for i := range apiResponse.Data {
		session := &apiResponse.Data[i]
		session.FormattedProgress = formatTracearrDuration(session.ProgressMs)
		session.FormattedDuration = formatTracearrDuration(session.DurationMs)
	}

	widget.Sessions = apiResponse.Data
	widget.Summary = apiResponse.Summary

	widget.withError(nil)
}

func (widget *tracearrWidget) Render() template.HTML {
	return widget.renderTemplate(widget, tracearrWidgetTemplate)
}
